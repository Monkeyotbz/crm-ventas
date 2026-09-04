// Widget de chat embebible de candyCRM (canal `chat_web`).
//
// Un solo <script> con data-attributes, sin dependencias. Vive fuera de
// src/ a propósito: no es parte de la SPA de candyCRM, es un archivo que se
// embebe en el sitio de OTRO tenant (hellominus.com primero) y tiene que
// funcionar servido suelto, sin pasar por el build de Vite.
//
// Shadow DOM a propósito: el sitio que lo embeba tiene su propio CSS, y sin
// aislamiento cualquier regla global (un `button { border: none }`, un
// `* { box-sizing: content-box }`) se filtra para adentro o para afuera.
//
// Identidad visual: "Candy + Aero" — paleta candy + glassmorphism real
// (backdrop-filter, bordes translúcidos, sombra de color) — ver el canvas
// de diseño del proyecto. No un diseño nuevo, es el sistema ya elegido.

(function () {
  "use strict";

  var script = document.currentScript;
  var WIDGET_KEY = script.getAttribute("data-widget-key");
  var API_URL = script.getAttribute("data-api-url");

  if (!WIDGET_KEY || !API_URL) {
    console.error("[candy-chat-widget] faltan data-widget-key o data-api-url en el <script>");
    return;
  }

  // ---------------------------------------------------------------------
  // Sesión anónima: se genera una vez por navegador y sobrevive a que se
  // cierre la pestaña. Es el identificador que resuelve el contacto del
  // lado del servidor (ver resolver_contacto_widget en la migración
  // 20260904171523) hasta que la persona escriba su email.
  // ---------------------------------------------------------------------
  function sesionAnonima() {
    var CLAVE = "candy_chat_sesion";
    try {
      var v = localStorage.getItem(CLAVE);
      if (!v) {
        v = "web_" + crypto.randomUUID();
        localStorage.setItem(CLAVE, v);
      }
      return v;
    } catch (e) {
      // Navegación privada o localStorage bloqueado: la sesión no persiste
      // entre recargas, pero el widget igual funciona dentro de esta visita.
      return "web_" + crypto.randomUUID();
    }
  }

  var sesion = sesionAnonima();
  var emailGuardado = null;
  try { emailGuardado = localStorage.getItem("candy_chat_email"); } catch (e) {}

  // El sitio que embebe el widget no tiene por qué cargar Baloo 2 — se pide
  // acá. Un <link> en el documento real, no dentro del shadow root: así es
  // como los widgets embebibles cargan fuentes de forma confiable entre
  // navegadores, y el font-face resultante igual aplica adentro del shadow.
  if (!document.getElementById("candy-chat-font")) {
    var link = document.createElement("link");
    link.id = "candy-chat-font";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Baloo+2:wght@700&display=swap";
    document.head.appendChild(link);
  }

  // ---------------------------------------------------------------------
  // Host + Shadow DOM
  // ---------------------------------------------------------------------
  var host = document.createElement("div");
  host.id = "candy-chat-widget-host";
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });

  var style = document.createElement("style");
  style.textContent = `
    :host, * { box-sizing: border-box; }
    .wrap {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .burbuja {
      width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer;
      background: linear-gradient(135deg, #ff5ca8, #b98bff);
      box-shadow: 0 8px 24px -6px rgba(255, 92, 168, 0.55), 0 2px 8px rgba(0,0,0,0.15);
      display: flex; align-items: center; justify-content: center;
      transition: transform .15s ease;
    }
    .burbuja:hover { transform: scale(1.06); }
    .burbuja svg { width: 26px; height: 26px; fill: #fff; }

    .panel {
      position: absolute; right: 0; bottom: 76px;
      width: 340px; max-width: calc(100vw - 32px);
      height: 480px; max-height: calc(100vh - 120px);
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.72);
      backdrop-filter: blur(20px) saturate(160%);
      -webkit-backdrop-filter: blur(20px) saturate(160%);
      border: 1px solid rgba(255, 255, 255, 0.6);
      box-shadow: 0 20px 60px -12px rgba(80, 40, 110, 0.35), inset 0 1px 0 rgba(255,255,255,0.8);
      display: none; flex-direction: column; overflow: hidden;
    }
    .panel.abierto { display: flex; }

    .cabecera {
      padding: 16px 18px;
      background: linear-gradient(120deg, #ff5ca8, #b98bff 70%);
      color: #fff; flex: none;
      display: flex; align-items: center; justify-content: space-between;
    }
    .cabecera h1 {
      font-family: "Baloo 2", -apple-system, sans-serif;
      font-size: 16px; font-weight: 700; margin: 0;
    }
    .cabecera p { margin: 2px 0 0; font-size: 12px; opacity: .92; }
    .cerrar {
      background: rgba(255,255,255,0.22); border: none; color: #fff;
      width: 26px; height: 26px; border-radius: 50%; cursor: pointer; font-size: 15px;
      display: flex; align-items: center; justify-content: center; flex: none;
    }

    .identidad {
      padding: 8px 14px; flex: none; border-bottom: 1px solid rgba(0,0,0,0.06);
    }
    .identidad input {
      width: 100%; border: 1px solid rgba(0,0,0,0.12); border-radius: 8px;
      padding: 6px 10px; font-size: 12px; background: rgba(255,255,255,0.7);
      outline: none;
    }
    .identidad input:focus { border-color: #ff5ca8; }
    .identidad label { font-size: 10.5px; color: #6b5c78; display: block; margin-bottom: 3px; }

    .mensajes {
      flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px;
    }
    .burbuja-msg {
      max-width: 78%; padding: 8px 12px; border-radius: 14px; font-size: 13.5px; line-height: 1.4;
      word-wrap: break-word; white-space: pre-wrap;
    }
    .in {
      align-self: flex-start; background: rgba(255,255,255,0.85);
      border: 1px solid rgba(0,0,0,0.06); color: #241d28; border-bottom-left-radius: 4px;
    }
    .out {
      align-self: flex-end; color: #fff; border-bottom-right-radius: 4px;
      background: linear-gradient(135deg, #ff5ca8, #ff8fc4);
    }
    .estado { align-self: flex-end; font-size: 10px; color: #9b8ea6; margin-top: -4px; }
    .bienvenida {
      align-self: flex-start; font-size: 12.5px; color: #6b5c78; padding: 4px 4px 8px;
    }

    .form {
      flex: none; padding: 10px; border-top: 1px solid rgba(0,0,0,0.06);
      display: flex; gap: 8px; background: rgba(255,255,255,0.4);
    }
    .form textarea {
      flex: 1; resize: none; border: 1px solid rgba(0,0,0,0.14); border-radius: 12px;
      padding: 8px 12px; font-size: 13.5px; font-family: inherit; outline: none;
      background: #fff; max-height: 80px; line-height: 1.35;
    }
    .form textarea:focus { border-color: #ff5ca8; }
    .enviar {
      flex: none; width: 38px; height: 38px; border-radius: 50%; border: none; cursor: pointer;
      background: linear-gradient(135deg, #ff5ca8, #b98bff); display: flex; align-items: center; justify-content: center;
    }
    .enviar:disabled { opacity: .5; cursor: default; }
    .enviar svg { width: 16px; height: 16px; fill: #fff; }

    .error { font-size: 11px; color: #c0266f; padding: 0 14px 8px; flex: none; }
  `;
  root.appendChild(style);

  var wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.innerHTML =
    '<button class="burbuja" type="button" aria-label="Abrir chat" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 5.94 2 10.8c0 2.77 1.47 5.24 3.77 6.85-.12.99-.5 2.36-1.5 3.85-.14.2 0 .48.26.47 1.86-.1 3.68-.78 4.99-1.6.79.16 1.62.24 2.48.24 5.52 0 10-3.94 10-8.81C22 5.94 17.52 2 12 2z"/></svg>' +
    "</button>" +
    '<div class="panel" role="dialog" aria-label="Chat">' +
      '<div class="cabecera">' +
        "<div><h1>candyCRM</h1><p>Normalmente respondemos en minutos</p></div>" +
        '<button class="cerrar" type="button" aria-label="Cerrar chat">✕</button>' +
      "</div>" +
      '<div class="identidad">' +
        '<label for="candy-email">Tu email (opcional, para poder responderte)</label>' +
        '<input id="candy-email" type="email" placeholder="vos@ejemplo.com" autocomplete="email" />' +
      "</div>" +
      '<div class="mensajes"><p class="bienvenida">Hola 👋 Contanos qué necesitás y te respondemos apenas podamos.</p></div>' +
      '<p class="error" hidden></p>' +
      '<form class="form">' +
        '<textarea rows="1" placeholder="Escribí tu mensaje…" aria-label="Mensaje"></textarea>' +
        '<button class="enviar" type="submit" aria-label="Enviar">' +
          '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>' +
        "</button>" +
      "</form>" +
    "</div>";
  root.appendChild(wrap);

  var burbujaBtn = wrap.querySelector(".burbuja");
  var panel = wrap.querySelector(".panel");
  var cerrarBtn = wrap.querySelector(".cerrar");
  var mensajesEl = wrap.querySelector(".mensajes");
  var form = wrap.querySelector(".form");
  var textarea = wrap.querySelector("textarea");
  var enviarBtn = wrap.querySelector(".enviar");
  var emailInput = wrap.querySelector("#candy-email");
  var errorEl = wrap.querySelector(".error");

  if (emailGuardado) emailInput.value = emailGuardado;

  function alternarPanel() {
    var abierto = panel.classList.toggle("abierto");
    burbujaBtn.setAttribute("aria-expanded", String(abierto));
    if (abierto) textarea.focus();
  }
  burbujaBtn.addEventListener("click", alternarPanel);
  cerrarBtn.addEventListener("click", alternarPanel);

  function agregarMensaje(texto, direccion) {
    var b = document.createElement("div");
    b.className = "burbuja-msg " + direccion;
    b.textContent = texto;
    mensajesEl.appendChild(b);
    mensajesEl.scrollTop = mensajesEl.scrollHeight;
  }

  function mostrarError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
  }

  textarea.addEventListener("input", function () {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 80) + "px";
  });
  textarea.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var texto = textarea.value.trim();
    if (!texto) return;

    var email = emailInput.value.trim();
    if (email) {
      try { localStorage.setItem("candy_chat_email", email); } catch (err) {}
    }

    agregarMensaje(texto, "out");
    textarea.value = "";
    textarea.style.height = "auto";
    enviarBtn.disabled = true;
    mostrarError("");

    try {
      var resp = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          widget_key: WIDGET_KEY,
          sesion: sesion,
          mensaje: texto,
          email: email || undefined,
          client_message_id: crypto.randomUUID(),
        }),
      });
      if (!resp.ok) {
        var cuerpo = await resp.json().catch(function () { return {}; });
        throw new Error(cuerpo.error || ("HTTP " + resp.status));
      }
    } catch (err) {
      console.error("[candy-chat-widget]", err);
      mostrarError("No se pudo enviar. Probá de nuevo en un momento.");
    } finally {
      enviarBtn.disabled = false;
    }
  });
})();
