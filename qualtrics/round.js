Qualtrics.SurveyEngine.addOnload(function () {
  
});


Qualtrics.SurveyEngine.addOnReady(function()
{
  var q = this;
  var ROUND = 1;
  var SCRIPT_URL = "https://ryankfrench.github.io/javascript_plinko/plinko.js?v=3";
  var latest = null;
  const sessionId = Qualtrics.SurveyEngine.getEmbeddedData("session_id");
  const subjectId = Qualtrics.SurveyEngine.getEmbeddedData("subject_id");

  function readEmbedded(name) {
    var value = "";
    try {
      value = Qualtrics.SurveyEngine.getEmbeddedData(name);
    } catch (err) {}
    if (value === undefined || value === null || String(value).trim() === "") {
      try {
        value = Qualtrics.SurveyEngine.getEmbeddedData("__js_" + name);
      } catch (err2) {}
    }
    if (value === undefined || value === null) return "";
    return String(value).trim();
  }

  function savedDecision() {
    var value = readEmbedded("plinko_r" + ROUND + "_decision");
    if (value === "play" || value === "decline") return value;
    return null;
  }

  function showNavigation() {
    q.showNextButton();
    if (typeof q.showPreviousButton === "function") q.showPreviousButton();
  }

  var alreadyDecided = savedDecision();
  if (alreadyDecided) {
    showNavigation();
  } else {
    q.hideNextButton();
    if (typeof q.hidePreviousButton === "function") q.hidePreviousButton();
  }

  var question =
    document.getElementById("question-" + q.questionId) ||
    document.getElementById(q.questionId);
  var body = question ? question.querySelector(".QuestionBody") : null;
  if (body) body.style.display = "none";

  function field() {
    if (!question) return null;
    return question.querySelector(
      "input.InputText, textarea.InputText, .text-input, .QuestionBody input, .QuestionBody textarea"
    );
  }

  var entry = field();
  if (entry) entry.style.display = "none";

  function embed(name, value) {
    try {
      Qualtrics.SurveyEngine.setEmbeddedData(name, value);
    } catch (err) {}
    try {
      Qualtrics.SurveyEngine.setJSEmbeddedData(name, value);
    } catch (err2) {}
  }

  var TIMESTAMPS = [
    "choice_iso",
    "animation_start_iso",
    "animation_end_iso",
    "next_enabled_iso"
  ];

  function formatStamp(iso) {
    if (typeof moment === "function") {
      return moment(iso).format("YYYY-MM-DD HH:mm:ss.SSS");
    }
    var d = new Date(iso);
    function pad(n, width) {
      var s = String(n);
      while (s.length < width) s = "0" + s;
      return s;
    }
    return (
      d.getFullYear() + "-" +
      pad(d.getMonth() + 1, 2) + "-" +
      pad(d.getDate(), 2) + " " +
      pad(d.getHours(), 2) + ":" +
      pad(d.getMinutes(), 2) + ":" +
      pad(d.getSeconds(), 2) + "." +
      pad(d.getMilliseconds(), 3)
    );
  }

  function writeTimestamps(result) {
    var prefix = "plinko_r" + ROUND + "_";
    TIMESTAMPS.forEach(function (name) {
      if (result[name]) embed(prefix + name.replace(/_iso$/, ""), formatStamp(result[name]));
    });
  }

  function write(result) {
    latest = result;
    var json = JSON.stringify(result);
    var input = field();
    if (input) {
      input.value = json;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    var prefix = "plinko_r" + ROUND + "_";
    var fields = {
      decision: result.decision,
      bin: String(result.bin),
      payout: String(result.payout),
      earnings: String(result.earnings),
      json: json
    };
    Object.keys(fields).forEach(function (name) {
      embed(prefix + name, fields[name]);
    });
    writeTimestamps(result);
  }

  Qualtrics.SurveyEngine.addOnPageSubmit(function () {
    if (latest) write(latest);
  });
 
  function getSeed(sessionId, subjectId, round) {
	  var subject = ("000" + subjectId).slice(-3);
      var seed = Number(String(sessionId) + subject + String(round));
	  return seed;
  }

  function rootEl() {
    return (
      document.querySelector("#" + q.questionId + " #plinko-root") ||
      document.getElementById("plinko-root")
    );
  }

  function failed() {
    var root = rootEl();
    if (root) root.textContent = "The task could not be loaded. Please tell the experimenter.";
  }

  function started() {
    var root = rootEl();
    if (!root || !window.Plinko) {
      if (window.console) console.error("Plinko did not attach", !!root, !!window.Plinko);
      failed();
      return;
    }
    window.Plinko.mount(root, {
	  round: ROUND,
	  responseId: "${e://Field/ResponseID}",
  	  animation: "guided-physics",
	  diskRadius: 0.34,
	  pegRadius: 0.09,
	  seed: getSeed(sessionId, subjectId, ROUND),
	  completed: !!alreadyDecided,
	  onChoice: function (result) {
		writeTimestamps(result);
	  },
	  onAnimationStart: function (result) {
		writeTimestamps(result);
	  },
	  onLand: function (result) {
		writeTimestamps(result);
	  },
	  onComplete: function (result) {
		write(result);
		showNavigation();
	  }
	});
  }

  var script = document.createElement("script");
  script.src = SCRIPT_URL;
  script.onload = started;
  script.onerror = function () {
    if (window.console) console.error("Plinko failed to load " + SCRIPT_URL);
    failed();
  };
  document.head.appendChild(script);
});

Qualtrics.SurveyEngine.addOnUnload(function()
{
	/*Place your JavaScript here to run when the page is unloaded*/

});