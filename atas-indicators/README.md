# ATAS custom indicators

A Visual Studio 2026 / .NET 10 class library of custom indicators for **ATAS 8 (classic, Windows)**.
It currently holds one starter indicator, **Delta Pulse**, meant as the base for real ones.

| File | What it is |
|---|---|
| `AtasIndicators.slnx` | Solution: open this in Visual Studio 2026 |
| `AtasIndicators/AtasIndicators.csproj` | Builds for the .NET version your ATAS runs on, references ATAS's DLLs from its install folder, copies the build into ATAS |
| `AtasIndicators/DeltaPulse.cs` | Starter indicator: per-bar delta histogram, EMA of delta, optional threshold alert |
| `AtasIndicators/Properties/launchSettings.json` | F5 starts ATAS under the debugger |

## Prerequisites

- ATAS 8 installed at the default `C:\Program Files (x86)\ATAS Platform`. Elsewhere is fine; see below.
- Visual Studio 2026 with the **.NET desktop development** workload, which includes the .NET 10 SDK.

**.NET version is detected, not hard-coded.** ATAS's Latest channel (8.0.15 included) runs on
.NET 10, but its Stable channel is still on .NET 8, and the version number doesn't tell them apart.
An indicator built for the wrong one fails to compile or fails to load. The project reads the `tfm`
from `OFT.Platform.runtimeconfig.json` in the ATAS install folder and builds for that
(`net10.0-windows` or `net8.0-windows`). The build output says which: `Copied AtasIndicators.dll
(net10.0-windows) ...`. Without that file it assumes .NET 10; force a value with
`/p:AtasTfm=net8.0`.

## Build and load

1. Open `AtasIndicators.slnx` and build.
2. The build copies `AtasIndicators.dll` (and its `.pdb`) to `%AppData%\ATAS\Indicators`, the folder
   ATAS loads custom indicators from.
3. If ATAS is already running, a **reload button** appears in its status bar. Press it once the build
   has finished, and the new DLL loads without a restart. A DLL still being written by the build is
   reported as not loaded; press reload again.
4. On a chart, open the indicators window and add **Delta Pulse**.

ATAS installed somewhere else? Build with `/p:AtasDir="D:\Path\To\ATAS Platform"`, or change the
`AtasDir` default in the `.csproj`. If ATAS isn't found, the build stops with one error naming the
folder it looked in. `/p:DeployToAtas=false` builds without copying.

## Debugging

- **F5** with the `ATAS` launch profile starts ATAS under the debugger. Breakpoints in
  `OnCalculate` then hit as bars calculate.
- Or start ATAS normally and use **Debug > Attach to Process**, choosing `OFT.Platform`.

The executable name `OFT.Platform.exe` is inferred from ATAS's `OFT.Platform.runtimeconfig.json`;
ATAS's docs don't name the executable. If F5 says the file is missing, look in the install folder
and fix `executablePath` in `launchSettings.json`.

## Writing a new indicator

Copy `DeltaPulse.cs`, rename the class and its `[DisplayName]`, and replace the body of
`OnCalculate`. The rules that trip people up:

- `OnCalculate(bar, value)` runs once per historical bar, then again on **every tick** of the live
  bar. Make it idempotent: read finished bars (`bar - 1`), overwrite `series[bar]`, and never add
  into a running total held in a field.
- Public properties with `[Display(...)]` become the indicator's settings, and ATAS saves them with
  the chart. Call `RecalculateValues()` in a setter when the change affects history.
- `Panel = IndicatorDataProvider.NewPanel` draws in a sub-panel. Leave `Panel` unset to draw over
  price.
- `base(true)` gives the indicator candle data (`GetCandle(bar)`: OHLC, `Volume`, `Delta`, ...).
- Series colors (`ValueDataSeries.Color`) are WPF colors (`System.Windows.Media.Color`) in classic
  ATAS. Per-bar colors (`series.Colors[bar]`) are `System.Drawing.Color`.

ATAS's own indicators are open source and are the best reference for anything further:
<https://github.com/AtasPlatform/Indicators> (`Technical/` holds about 270 real indicators).
Docs: <https://docs.atas.net/en/>.

## How this was checked

- The API calls and project settings were taken from ATAS's official repository (commit `0529e20`,
  2026-10-21) and docs.atas.net, not from memory.
- The project was compiled with the .NET 10 SDK against a **stub** of that API, with warnings treated
  as errors, against stand-in installs on .NET 8 and on .NET 10 (each built for the right target). That proves the code and build targets are well-formed. It does **not** prove the
  indicator runs inside ATAS: the first real build against ATAS's own DLLs happens on your machine.
