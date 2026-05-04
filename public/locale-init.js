(function () {
  try {
    var k = "accountech.locale";
    var v = localStorage.getItem(k);
    var allowed = ["en", "he", "ru"];
    if (allowed.indexOf(v) === -1) {
      var n = (navigator.language || "en").slice(0, 2).toLowerCase();
      v = allowed.indexOf(n) !== -1 ? n : "en";
    }
    document.documentElement.setAttribute("lang", v);
    document.documentElement.setAttribute("dir", v === "he" ? "rtl" : "ltr");
    document.documentElement.setAttribute("data-locale", v);
  } catch (e) {}
})();
