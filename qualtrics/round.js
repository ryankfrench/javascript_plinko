Qualtrics.SurveyEngine.addOnload(function () {
  var q = this;
  var ROUND = 1;
  var SCRIPT_URL = "https://ryankfrench.github.io/javascript_plinko/plinko.js?v=1";
  var latest = null;

  q.hideNextButton();
  if (typeof q.hidePreviousButton === "function") q.hidePreviousButton();

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
      var key = prefix + name;
      try {
        Qualtrics.SurveyEngine.setEmbeddedData(key, fields[name]);
      } catch (err) {}
      try {
        Qualtrics.SurveyEngine.setJSEmbeddedData(key, fields[name]);
      } catch (err2) {}
    });
  }

  Qualtrics.SurveyEngine.addOnPageSubmit(function () {
    if (latest) write(latest);
  });

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
      // animation defaults to "guided". Pass animation: "guided-physics" only for a pilot.
      onComplete: function (result) {
        write(result);
        q.showNextButton();
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
