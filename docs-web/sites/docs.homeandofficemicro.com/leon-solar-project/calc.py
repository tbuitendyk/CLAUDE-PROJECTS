import math

# ============ CONSTANTS / INPUTS ============
# Panel: LONGi LR7-72HVHF-650M (datasheet, verified)
PL = 2382.0   # panel length mm
PW = 1134.0   # panel width mm
PT = 30.0     # frame height mm
PKG = 28.5    # kg
ROOF_EW = 9140.0  # mm
ROOF_NS = 4820.0  # mm
N = 8         # panels per row
GAP_MID = 20.0    # assumed mid-clamp gap mm (LONGi min 10, flag: verify)
RAIL_H = 40.0     # assumed Vektor-8 rail height mm (flag: verify)
CLAMP_D = 491.0   # clamp dist from panel ends = (2382-1400)/2, outer bolt-hole line
RAIL_SPACING_SLOPE = PL - 2*CLAMP_D  # 1400 mm

th30 = math.radians(30); th10 = math.radians(10)

print("=== ROW GEOMETRY ===")
for name, th in (("30deg", th30), ("10deg", th10)):
    proj = PL*math.cos(th); rise = PL*math.sin(th)
    print(f"{name}: projected depth {proj:.1f} mm, rise {rise:.1f} mm, "
          f"rail spacing horiz {RAIL_SPACING_SLOPE*math.cos(th):.1f}, "
          f"front rail from low edge horiz {CLAMP_D*math.cos(th):.1f}")

gap = ROOF_NS - PL*math.cos(th30) - PL*math.cos(th10)
print(f"N-S: 2063.0 + 2346.1 = {PL*math.cos(th30)+PL*math.cos(th10):.1f}; actual inter-row gap if flush = {gap:.1f} mm")

arr_w = N*PW + (N-1)*GAP_MID
print(f"Array width = {arr_w:.0f} mm vs roof {ROOF_EW:.0f} -> overhang/side = {(arr_w-ROOF_EW)/2:.1f} mm")

print("\n=== ELEVATIONS (panel low edge: 30deg row = 250 mm, 10deg row = 150 mm) ===")
for name, th, hlow in (("30deg", th30, 250.0), ("10deg", th10, 150.0)):
    tos_f = hlow + CLAMP_D*math.sin(th) - RAIL_H
    tos_r = hlow + (CLAMP_D+RAIL_SPACING_SLOPE)*math.sin(th) - RAIL_H
    hhigh = hlow + PL*math.sin(th)
    chord_vdepth = 51.0/math.cos(th)
    postF = tos_f - chord_vdepth - 51.0   # base PTR 51 high
    postR = tos_r - chord_vdepth - 51.0
    print(f"{name}: TOS front {tos_f:.1f}, TOS rear {tos_r:.1f}, panel high edge {hhigh:.1f}, "
          f"postF cut {postF:.1f}, postR cut {postR:.1f}, chord vert depth {chord_vdepth:.1f}")

print("\n=== SHADING CHECK (Leon ~21.12N, winter solstice noon alt = 90-21.12-23.44) ===")
alt_noon = 90-21.12-23.44
h10_top = 150 + PL*math.sin(th10)     # 10-row north edge
h30_low = 250.0
dh = h10_top - h30_low
shadow_noon = dh/math.tan(math.radians(alt_noon))
alt_crit = math.degrees(math.atan(dh/gap))
print(f"solstice noon alt {alt_noon:.1f} deg; 10-row top {h10_top:.0f}, dh {dh:.0f}, "
      f"noon shadow {shadow_noon:.0f} vs gap {gap:.0f}; grazing begins below alt {alt_crit:.1f} deg")

print("\n=== LOADS ===")
q_panel = 1600.0  # Pa design envelope (module design limit 2400/1.5 uplift)
raft_sp = ROOF_EW/8.0
trib = (raft_sp/1000.0)*(RAIL_SPACING_SLOPE/1000.0*0.5 + CLAMP_D/1000.0)  # per rail contact = spacing x half panel
# actually per contact = raft spacing x (panel length/2) since 2 rails share panel
trib = (raft_sp/1000.0)*(PL/2000.0)
P_pt = q_panel*trib/1000.0  # kN normal to panel per rail contact per rafter
print(f"rafter spacing {raft_sp:.1f} mm; tributary/contact {trib:.3f} m2; P/contact {P_pt:.2f} kN ({P_pt*101.97:.0f} kgf)")
for name, th in (("30deg", th30), ("10deg", th10)):
    Pn = 2*P_pt
    Pv = Pn*math.cos(th); Ph = Pn*math.sin(th)
    dead = (raft_sp/1000.0)*(PL/1000.0)*(PKG/((PL/1000)*(PW/1000)))*9.81/1000.0  # panel dead per rafter kN
    dead_tot = dead + 0.25  # + steel ~20kg + rail share ~5kg
    net_up = Pv - dead_tot
    print(f"{name}: uplift normal {Pn:.2f} kN -> vert {Pv:.2f}, horiz {Ph:.2f}; dead ~{dead_tot:.2f}; "
          f"net vert uplift/rafter {net_up:.2f} kN -> per anchor(2) {net_up/2:.2f} kN, "
          f"design w/1.5 ecc {net_up/2*1.5:.2f} kN ({net_up/2*1.5*101.97:.0f} kgf); shear/anchor {Ph/2:.2f} kN")

print("\n=== MEMBER CHECKS (PTR 51x51x3.0 A500-B, Fy=317 MPa, allow 0.6Fy=190; conservative Fy=250->150) ===")
Z = (51*51**3 - 45*45**3)/(6*51)  # mm3
A = (51**2-45**2)  # mm2
I = (51**4-45**4)/12
r = math.sqrt(I/A)
print(f"51x51x3: A={A} mm2, Z={Z:.0f} mm3, I={I:.0f} mm4, r={r:.1f} mm, mass={A*7.85e-3:.2f} kg/m")
# chord construction point load 1 kN mid between posts (1.4 m slope span)
Mc = 1.0*1.4/4*1e6  # N.mm
print(f"chord 1kN person midspan: M={Mc/1e6:.2f} kN.m, sigma={Mc/Z:.0f} MPa (allow 150)")
# rear post buckling, 1.05 m, K=1
L=1046.0; lam = L/r
print(f"rear post 30deg: KL/r = {lam:.0f} (limit ~200; Euler Fcr={math.pi**2*200000/lam**2:.0f} MPa >> demand {2*P_pt*1000/A:.1f} MPa)")
Z38 = (38*38**3 - 32*32**3)/(6*38); A38=(38**2-32**2)
print(f"38x38x3: A={A38} mm2, Z={Z38:.0f} mm3, mass={A38*7.85e-3:.2f} kg/m")

print("\n=== ALUMINUM RAIL CHECK (Z assumed 3.5 cm3 - UNVERIFIED) ===")
w = q_panel*(PL/2000.0)/1000.0  # kN/m on one rail
M = w*(raft_sp/1000.0)**2/10*1e6
print(f"w={w:.2f} kN/m, continuous M=wL^2/10={M/1e6:.3f} kN.m, sigma={M/3500:.0f} MPa (6005-T5 allow ~140)")

print("\n=== RAIL CUT SCHEDULE (rail 9300, roof x=0..9140, rafters every 1142.5) ===")
rafters=[i*raft_sp for i in range(9)]
print("rafter x:", [f"{x:.0f}" for x in rafters])
print("Rail N of each pair: 4850 + 4450 (splice x = -80+4850 = 4770; 200 E of rafter5 @4570)")
print("Rail S of each pair: 4450 + 4850 (splice x = 4370; 200 W of rafter5)")
print("offcuts per 5400 stick: 550 and 950 -> 4 runs x (0.55+0.95) = 6.0 m to phase 2")
joints=[(-(arr_w-ROOF_EW)/2)+ (i)*PW + (i-0.5)*GAP_MID for i in range(1,8)]
print("mid-clamp centers x:", [f"{x:.0f}" for x in joints])

print("\n=== STEEL BOM ===")
r30 = 1512+346+1046+1600; r10=1679+93+336+1600
tot51 = 9*(r30+r10)/1000
ties = 4*9.2
diag = 4*math.hypot(raft_sp/1000,1.046)+4*math.hypot(raft_sp/1000,0.336)
tot38 = ties+diag
print(f"30deg rafter {r30} mm x9; 10deg rafter {r10} mm x9; 51x51 total {tot51:.1f} m -> {math.ceil(tot51*1.07/6.1)} tramos 6.1m, {tot51*A*7.85e-3:.0f} kg")
print(f"ties {ties:.1f} m + diagonals {diag:.1f} m = 38x38 {tot38:.1f} m -> {math.ceil(tot38*1.1/6.1)} tramos, {tot38*A38*7.85e-3:.0f} kg")
print(f"diag lengths: 30row {math.hypot(raft_sp,1046):.0f} mm, 10row {math.hypot(raft_sp,336):.0f} mm")
tot_dead = 16*PKG + tot51*A*7.85e-3 + tot38*A38*7.85e-3 + 37.2*1.5
print(f"total system mass ~{tot_dead:.0f} kg over {ROOF_EW*ROOF_NS/1e6:.1f} m2 = {tot_dead/(ROOF_EW*ROOF_NS/1e6):.1f} kg/m2 avg")
