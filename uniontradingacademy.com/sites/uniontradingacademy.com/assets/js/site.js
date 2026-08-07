/* Union Trading Academy — comportamiento del sitio.
   Sin dependencias. Lee window.UTA_CONFIG (config.js). */
(function () {
  var C = window.UTA_CONFIG || {};

  function waHref(text) {
    if (!C.WHATSAPP_NUMBER) return null;
    return "https://wa.me/" + C.WHATSAPP_NUMBER +
      (text ? "?text=" + encodeURIComponent(text) : "");
  }

  // --- WhatsApp: enlaza todos los [data-wa]; sin número, se ocultan. ---
  var waLinks = document.querySelectorAll("[data-wa]");
  var isGracias = document.body.classList.contains("gracias-body");
  var href = waHref(isGracias ? C.WHATSAPP_TEXT_GRACIAS : C.WHATSAPP_TEXT);
  waLinks.forEach(function (a) {
    if (href) {
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.classList.remove("hidden");
    } else {
      // Botones de texto: llevar a la agenda como reserva; el flotante y los
      // botones exclusivos de WhatsApp se ocultan.
      if (a.classList.contains("wa-float") || a.hasAttribute("data-wa-only")) { a.classList.add("hidden"); }
      else {
        a.textContent = "Más información";
        a.href = document.body.dataset.agendaPath || "agenda/";
        a.classList.remove("btn-wa");
        a.classList.add("btn-ghost");
      }
    }
  });

  // --- Video principal (landing): con VIDEO_SRC se activa el reproductor. ---
  var slot = document.getElementById("video-slot");
  if (slot) {
    var overlay = slot.querySelector(".video-overlay");
    var pending = document.getElementById("video-pending");
    if (C.VIDEO_SRC) {
      var play = function () {
        var v = document.createElement("video");
        v.src = C.VIDEO_SRC;
        v.controls = true;
        v.autoplay = true;
        v.playsInline = true;
        v.poster = (slot.querySelector("img.poster") || {}).src || "";
        slot.innerHTML = "";
        slot.appendChild(v);
      };
      overlay && overlay.querySelector(".play-badge").addEventListener("click", play);
    } else {
      overlay && overlay.querySelector(".play-badge").addEventListener("click", function () {
        pending && pending.classList.remove("hidden");
      });
    }
  }

  // --- Calendly (página agenda): embed inline o panel de reserva. ---
  var cal = document.getElementById("calendly-slot");
  if (cal) {
    if (C.CALENDLY_URL) {
      var div = document.createElement("div");
      div.className = "calendly-inline-widget";
      div.setAttribute("data-url", C.CALENDLY_URL + "?hide_gdpr_banner=1&primary_color=1e6ff2");
      div.style.minWidth = "320px";
      div.style.height = "760px";
      cal.innerHTML = "";
      cal.appendChild(div);
      var s = document.createElement("script");
      s.src = "https://assets.calendly.com/assets/external/widget.js";
      s.async = true;
      document.body.appendChild(s);
    } else {
      document.getElementById("calendly-fallback").classList.remove("hidden");
    }
  }

  // --- Pagos (Mercado Pago): elementos [data-pago] solo con link real. ---
  document.querySelectorAll("[data-pago]").forEach(function (el) {
    if (C.MERCADOPAGO_LINK) {
      el.href = C.MERCADOPAGO_LINK;
      el.target = "_blank";
      el.rel = "noopener";
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
})();
