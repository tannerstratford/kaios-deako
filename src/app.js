// Deako Lights for KaiOS. D-pad up/down moves the highlight, OK toggles the
// selected light, number keys 1-9 toggle the Nth light, left soft key is All
// Off, right soft key opens the menu. Views are {title, render, key}; one
// global keydown handler routes to whichever view is on top of the stack.
//
// The lights are reached through window.Deako, which connects either directly
// over TCP to the Deako gateway (standalone, no computer) or via the HTTP
// controller as a fallback. See deako.js.
"use strict";

var $ = function (id) { return document.getElementById(id); };
var busy = false;
var connected = false;
var lights = [];        // last fetched device list
var sel = 0;            // highlighted row index
var viewStack = [];

// ---------------------------------------------------------------- chrome

function status(text, ok) {
  $("status").textContent = text;
  $("status").classList.toggle("err", ok === false);
}

function softkeys(left, center, right) {
  $("sk-left").textContent = left || "";
  $("sk-center").textContent = center || "";
  $("sk-right").textContent = right || "";
}

function push(view) { viewStack.push(view); show(); }
function pop() { if (viewStack.length > 1) viewStack.pop(); show(); }
function topView() { return viewStack[viewStack.length - 1]; }
function show() {
  var v = topView();
  $("title").textContent = v.title();
  $("view").innerHTML = "";
  v.render($("view"));
}

window.addEventListener("keydown", function (e) {
  if (topView().key(e) !== false) e.preventDefault();
});

function esc(s) {
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ---------------------------------------------------------------- lights view

var LightsView = {
  title: function () { return "Lights"; },
  render: function (el) {
    softkeys("All Off", lights.length ? "Toggle" : "", "Menu");
    if (!lights.length) {
      el.innerHTML = '<div class="empty">' +
        (connected ? "No lights found." : "Not connected.") +
        "<br>Right soft key &gt; Menu &gt; Connection.</div>";
      return;
    }
    var ul = document.createElement("ul");
    ul.className = "list";
    lights.forEach(function (d, i) {
      var li = document.createElement("li");
      li.className = "light" + (d.power ? " on" : "") + (i === sel ? " sel" : "");
      li.innerHTML =
        '<span class="dot"></span>' +
        '<span class="name">' + esc(d.name) + "</span>" +
        '<span class="sw' + (d.power ? " on" : "") + '"></span>';
      ul.appendChild(li);
    });
    el.appendChild(ul);
    if (ul.children[sel]) ul.children[sel].scrollIntoView({ block: "nearest" });
  },
  key: function (e) {
    switch (e.key) {
      case "ArrowDown": return move(1);
      case "ArrowUp": return move(-1);
      case "Enter": return lights[sel] && toggle(lights[sel]);
      case "SoftLeft": return allLights(false);
      case "SoftRight": return push(MenuView());
      case "Backspace": return; // stay on list; swallow so it doesn't exit
      default:
        if (/^[1-9]$/.test(e.key)) {
          var i = parseInt(e.key, 10) - 1;
          if (lights[i]) { sel = i; show(); toggle(lights[i]); }
          return;
        }
        return false;
    }
  },
};

function move(d) {
  if (!lights.length) return;
  sel = (sel + d + lights.length) % lights.length;
  show();
}

function renderStatus() {
  var on = lights.filter(function (d) { return d.power; }).length;
  status(lights.length + " lights · " + on + " on · " + Deako.label());
}

// ---------------------------------------------------------------- connection + actions

function connectAndLoad() {
  if (busy) return;
  busy = true;
  connected = false;
  status("Connecting…");
  Deako.connect().then(function () {
    connected = true;
    return Deako.devices();
  }).then(function (list) {
    lights = list || [];
    if (sel >= lights.length) sel = Math.max(0, lights.length - 1);
    renderStatus();
    if (topView() === LightsView) show();
  }).catch(function (err) {
    connected = false;
    status("Offline: " + err.message, false);
    if (topView() === LightsView) show();
  }).then(function () { busy = false; });
}

function refresh() {
  if (busy) return Promise.resolve();
  if (!connected) { connectAndLoad(); return Promise.resolve(); }
  return Deako.devices().then(function (list) {
    lights = list || [];
    if (sel >= lights.length) sel = Math.max(0, lights.length - 1);
    renderStatus();
    if (topView() === LightsView) show();
  }).catch(function (err) {
    connected = false;
    status("Lost connection: " + err.message, false);
  });
}

function toggle(d) {
  if (busy || !connected) return;
  busy = true;
  var want = !d.power;
  d.power = want;                       // optimistic
  if (topView() === LightsView) show();
  Deako.control(d.uuid, want).then(function () {
    status(d.name + " → " + (want ? "On" : "Off"));
  }).catch(function (err) {
    d.power = !want;                    // revert on failure
    status("Failed: " + err.message, false);
    if (topView() === LightsView) show();
  }).then(function () {
    busy = false;
    setTimeout(refresh, 500);           // reconcile with real state
  });
}

function allLights(power) {
  if (busy || !connected) return;
  busy = true;
  status(power ? "All on…" : "All off…");
  Deako.all(power).then(function () {
    lights.forEach(function (d) { d.power = power; });
    if (topView() === LightsView) show();
  }).catch(function (err) {
    status("Failed: " + err.message, false);
  }).then(function () {
    busy = false;
    setTimeout(refresh, 600);
  });
}

// Live state changes pushed by the gateway (e.g. someone flips a physical
// switch) only come over TCP. Re-render when they arrive.
Deako.onEvent = function () {
  if (topView() === LightsView) { renderStatus(); show(); }
};

// ---------------------------------------------------------------- list + prompt views

function ListView(title, items) {
  var s = Math.max(0, items.findIndex ? items.findIndex(function (i) { return !i.head; }) : 0);
  if (s < 0) s = 0;
  var v = {
    title: function () { return title; },
    render: function (el) {
      softkeys("", "Select", "Back");
      var ul = document.createElement("ul");
      ul.className = "list";
      items.forEach(function (it, i) {
        var li = document.createElement("li");
        li.className = it.head ? "head" : (i === s ? "sel" : "");
        li.textContent = it.label;
        if (it.sub) {
          var sub = document.createElement("div");
          sub.className = "sub";
          sub.textContent = it.sub;
          li.appendChild(sub);
        }
        ul.appendChild(li);
      });
      el.appendChild(ul);
      if (ul.children[s]) ul.children[s].scrollIntoView({ block: "nearest" });
    },
    move: function (d) {
      if (!items.some(function (i) { return !i.head; })) return;
      do { s = (s + d + items.length) % items.length; } while (items[s].head);
      show();
    },
    key: function (e) {
      switch (e.key) {
        case "ArrowDown": return v.move(1);
        case "ArrowUp": return v.move(-1);
        case "Enter": return items[s] && !items[s].head && items[s].run();
        case "SoftRight": case "Backspace": return pop();
        default: return false;
      }
    },
  };
  return v;
}

function PromptView(title, hint, value, type, onSubmit) {
  return {
    title: function () { return title; },
    render: function (el) {
      softkeys("Cancel", "OK", "");
      el.innerHTML = '<div class="form"><p></p><input></div>';
      el.querySelector("p").textContent = hint;
      var input = el.querySelector("input");
      input.type = type;
      input.value = value || "";
      setTimeout(function () { input.focus(); }, 50);
    },
    key: function (e) {
      var input = document.querySelector(".form input");
      if (e.key === "Enter") return onSubmit(input.value.trim());
      if (e.key === "SoftLeft" || (e.key === "Backspace" && !input.value)) return pop();
      return false; // let the field handle typing
    },
  };
}

// ---------------------------------------------------------------- menu

function MenuView() {
  var cfg = Deako.Store.load();
  return ListView("Menu", [
    { label: "All On", run: function () { pop(); allLights(true); } },
    { label: "All Off", run: function () { pop(); allLights(false); } },
    { label: "Refresh", run: function () { pop(); refresh(); } },
    { label: "Reconnect", sub: Deako.label(), run: function () { pop(); connectAndLoad(); } },
    { head: true, label: "CONNECTION" },
    {
      label: "Mode", sub: modeLabel(cfg.mode),
      run: function () { push(ModeView()); },
    },
    {
      label: "Gateway (direct)", sub: cfg.gateway,
      run: function () { push(AddrView("Gateway", "Deako switch IP:port (the Wi-Fi switch)", "gateway", cfg.gateway, /^\d+\.\d+\.\d+\.\d+:\d+$/)); },
    },
    {
      label: "Controller (HTTP)", sub: cfg.host,
      run: function () { push(AddrView("Controller", "Computer running app.py, IP:port", "host", cfg.host, /^\d+\.\d+\.\d+\.\d+:\d+$/)); },
    },
    { label: "Diagnostics", sub: "Why TCP won't connect", run: function () { push(DiagView()); } },
    { head: true, label: "" },
    { label: "Exit", run: function () { window.close(); } },
  ]);
}

function DiagView() {
  var lines = ("TCP diagnostics\n" + Deako.diag()).split("\n");
  return ListView("Diagnostics", lines.map(function (l) {
    return { label: l || " ", run: function () {} };
  }));
}

function modeLabel(m) {
  return m === "tcp" ? "Direct TCP only" : m === "http" ? "HTTP controller only" : "Auto (TCP, then HTTP)";
}

function ModeView() {
  var cfg = Deako.Store.load();
  function pick(m) { cfg.mode = m; Deako.Store.save(cfg); viewStack = [LightsView]; show(); connectAndLoad(); }
  return ListView("Mode", [
    { label: "Auto", sub: "Try direct TCP, fall back to HTTP", run: function () { pick("auto"); } },
    { label: "Direct TCP only", sub: "Standalone, no computer", run: function () { pick("tcp"); } },
    { label: "HTTP controller only", sub: "Needs app.py running", run: function () { pick("http"); } },
  ]);
}

function AddrView(title, hint, field, value, re) {
  return PromptView(title, hint, value, "text", function (val) {
    if (!re.test(val)) return status("Use the form 192.168.1.60:8099", false);
    var cfg = Deako.Store.load();
    cfg[field] = val;
    Deako.Store.save(cfg);
    viewStack = [LightsView];
    show();
    connectAndLoad();
  });
}

// ---------------------------------------------------------------- start

viewStack = [LightsView];
show();
connectAndLoad();

// Poll as a safety net (TCP also pushes live EVENTs; HTTP relies on this).
setInterval(function () {
  if (busy || document.hidden || topView() !== LightsView) return;
  refresh();
}, 10000);
