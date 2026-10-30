// Deako Lights for KaiOS. D-pad up/down moves the highlight, OK toggles the
// selected light, number keys 1-9 toggle the Nth light, left soft key is All
// Off, right soft key opens the menu. Views are {title, render, key}; one
// global keydown handler routes to whichever view is on top of the stack.
"use strict";

var $ = function (id) { return document.getElementById(id); };
var busy = false;
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
      el.innerHTML = '<div class="empty">No lights.<br>Left soft key &gt; Controller address, then Refresh.</div>';
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

// ---------------------------------------------------------------- actions

function refresh() {
  if (busy) return Promise.resolve();
  status("Loading…");
  return Deako.Api.devices().then(function (list) {
    lights = list;
    if (sel >= lights.length) sel = Math.max(0, lights.length - 1);
    var on = lights.filter(function (d) { return d.power; }).length;
    status(lights.length + " lights · " + on + " on");
    if (topView() === LightsView) show();
  }).catch(function (err) {
    status("Offline: " + err.message + " (" + Deako.Api.host() + ")", false);
    if (topView() === LightsView) show();
  });
}

function toggle(d) {
  if (busy) return;
  busy = true;
  var want = !d.power;
  d.power = want;                       // optimistic
  if (topView() === LightsView) show();
  Deako.Api.control(d.uuid, want).then(function () {
    status(d.name + " → " + (want ? "On" : "Off"));
  }).catch(function (err) {
    d.power = !want;                    // revert on failure
    status("Failed: " + err.message, false);
    if (topView() === LightsView) show();
  }).then(function () {
    busy = false;
    setTimeout(refresh, 400);           // reconcile with real state
  });
}

function allLights(power) {
  if (busy) return;
  busy = true;
  status(power ? "All on…" : "All off…");
  Deako.Api.all(power).then(function () {
    lights.forEach(function (d) { d.power = power; });
    if (topView() === LightsView) show();
  }).catch(function (err) {
    status("Failed: " + err.message, false);
  }).then(function () {
    busy = false;
    setTimeout(refresh, 500);
  });
}

// ---------------------------------------------------------------- list + prompt views (from the TV remote framework)

function ListView(title, items) {
  var s = 0;
  var v = {
    title: function () { return title; },
    render: function (el) {
      softkeys("", "Select", "Back");
      var ul = document.createElement("ul");
      ul.className = "list";
      items.forEach(function (it, i) {
        var li = document.createElement("li");
        li.className = i === s ? "sel" : "";
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
    key: function (e) {
      switch (e.key) {
        case "ArrowDown": s = (s + 1) % items.length; show(); return;
        case "ArrowUp": s = (s - 1 + items.length) % items.length; show(); return;
        case "Enter": return items[s] && items[s].run();
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
    {
      label: "Controller address", sub: cfg.host,
      run: function () { push(HostView()); },
    },
    { label: "Exit", run: function () { window.close(); } },
  ]);
}

function HostView() {
  var cfg = Deako.Store.load();
  return PromptView("Controller address",
    "Home machine running the Lights controller, as IP:port (e.g. 192.168.1.60:8099)",
    cfg.host, "text", function (val) {
      if (!/^\d+\.\d+\.\d+\.\d+:\d+$/.test(val)) {
        return status("Use the form 192.168.1.60:8099", false);
      }
      cfg.host = val;
      Deako.Store.save(cfg);
      viewStack = [LightsView];
      show();
      refresh();
    });
}

// ---------------------------------------------------------------- start

viewStack = [LightsView];
show();
refresh();

// Keep the state line honest while the list is up.
setInterval(function () {
  if (busy || document.hidden || topView() !== LightsView) return;
  refresh();
}, 10000);
