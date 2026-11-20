Qualtrics.SurveyEngine.addOnload(function () {
  var params = new URLSearchParams(window.location.search);
  var subjectRaw = "${e://Field/subject_id}";
  if (!/^\d+$/.test(String(subjectRaw).trim())) {
    subjectRaw = params.get("subject_id") || "";
  }
  var earningsRaw = params.get("ug_earnings");
  if (!earningsRaw) earningsRaw = "${e://Field/ug_earnings}";

  var subjectId = parseInt(String(subjectRaw).trim(), 10);
  var earnings = String(earningsRaw).split(",");
  var token = "";
  if (subjectId >= 1 && subjectId <= earnings.length) {
    token = earnings[subjectId - 1].trim();
  }
  if (!/^-?\d+$/.test(token)) {
    if (window.console) {
      console.warn(
        "Could not read a decision payment from ug_earnings.",
        subjectRaw,
        earningsRaw
      );
    }
    return;
  }
  try {
    Qualtrics.SurveyEngine.setJSEmbeddedData(
      "decision_payment",
      String(parseInt(token, 10))
    );
  } catch (err) {}
});


Qualtrics.SurveyEngine.addOnReady(function()
{
  var q = this;
  var ROUND = 1;
  var SCRIPT_URL = "https://ryankfrench.github.io/javascript_plinko/plinko.js?v=5";
  var latest = null;
  const sessionId = "${e://Field/session_id}";
  const subjectId = "${e://Field/subject_id}";

  function readEmbedded(name) {
    var value = "";
    try {
      value = Qualtrics.SurveyEngine.getJSEmbeddedData("__js_" + name);
    } catch (err2) {}
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
    if (typeof q.enableNextButton === "function") q.enableNextButton();
    if (typeof q.showPreviousButton === "function") q.showPreviousButton();
  }

  var alreadyDecided = savedDecision();
  if (alreadyDecided) {
    showNavigation();
  } else {
    q.showNextButton();
    if (typeof q.disableNextButton === "function") q.disableNextButton();
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

  function stampField(isoName) {
    if (isoName === "choice_iso") return "decision_click_time";
    return isoName.replace(/_iso$/, "");
  }

  function writeTimestamps(result) {
    var prefix = "plinko_r" + ROUND + "_";
    TIMESTAMPS.forEach(function (name) {
      if (result[name]) embed(prefix + stampField(name), formatStamp(result[name]));
    });
  }

  var nextClickField = "plinko_r" + ROUND + "_next_click_time";
  var nextClickRecorded = !!readEmbedded(nextClickField);

  function recordNextClick() {
    if (nextClickRecorded) return;
    nextClickRecorded = true;
    embed(nextClickField, formatStamp(new Date().toISOString()));
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
    recordNextClick();
    if (latest) write(latest);
  });
 
  function hashSeed(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }

  function getSeed(sessionId, subjectId, round) {
    var session = sessionId === undefined || sessionId === null ? "" : String(sessionId).trim();
    var subject = subjectId === undefined || subjectId === null ? "" : String(subjectId).trim();
    if (!session || !subject) {
      if (window.console) {
        console.warn("Plinko seed is missing session_id or subject_id.", session, subject);
      }
    }
    return hashSeed(session + "|" + subject + "|" + String(round));
  }

  var SUBJECTS_PER_SESSION = 12;

  function integerField(raw) {
    var text = raw === undefined || raw === null ? "" : String(raw).trim();
    if (!/^-?\d+$/.test(text)) return null;
    return parseInt(text, 10);
  }

  function urnIndex() {
    var subject = integerField(subjectId);
    if (subject === null || subject < 1) {
      return { error: "Plinko subject_id is missing or not a positive integer." };
    }
    var past = integerField("${e://Field/past_subject_offset}");
    var offset = past;
    if (offset === null) {
      var session = integerField(sessionId);
      if (session === null) {
        return { error: "Plinko session_id is missing or not an integer." };
      }
      offset = (session - 1) * SUBJECTS_PER_SESSION;
    }
    var index = offset + (subject - 1);
    if (index < 0) return { error: "Plinko urn index is negative (" + index + ")." };
    return { index: index };
  }

  function parseUrn(raw) {
    if (!raw) return { error: "Plinko urn is missing for round " + ROUND + "." };
    var list;
    try {
      list = JSON.parse(raw);
    } catch (err) {
      return { error: "Plinko urn was not JSON." };
    }
    if (!Array.isArray(list)) return { error: "Plinko urn was not a list of paths." };
    return { list: list };
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

  function started(path) {
    var root = rootEl();
    if (!root || !window.Plinko) {
      if (window.console) console.error("Plinko did not attach", !!root, !!window.Plinko);
      failed();
      return;
    }
    try {
      window.Plinko.mount(root, {
	  round: ROUND,
	  responseId: "${e://Field/ResponseID}",
  	  animation: "guided-physics",
	  diskRadius: 0.34,
	  pegRadius: 0.09,
	  path: path,
	  seed: getSeed(sessionId, subjectId, ROUND),
	  revealDwellMs: 10000,
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
    } catch (err) {
      if (window.console) console.error(err);
      failed();
    }
  }

  var urn = parseUrn(readEmbedded("urn_r" + ROUND));
  var picked = urnIndex();
  var chosenPath = "";
  if (picked.error) {
    if (window.console) console.error(picked.error);
    failed();
  } else if (urn.error) {
    if (window.console) console.error(urn.error);
    failed();
  } else if (picked.index >= urn.list.length) {
    if (window.console) {
      console.error("Plinko urn index " + picked.index + " is past the end of the urn.");
    }
    failed();
  } else if (!/^[LR]{8}$/.test(urn.list[picked.index])) {
    if (window.console) {
      console.error("Plinko urn path at index " + picked.index + " is not 8 L/R steps.");
    }
    failed();
  } else {
    chosenPath = urn.list[picked.index];
  }

  if (chosenPath) {
    var script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.onload = function () {
      started(chosenPath);
    };
    script.onerror = function () {
      if (window.console) console.error("Plinko failed to load " + SCRIPT_URL);
      failed();
    };
    document.head.appendChild(script);
  }
});

Qualtrics.SurveyEngine.addOnUnload(function()
{
	/*Place your JavaScript here to run when the page is unloaded*/

});