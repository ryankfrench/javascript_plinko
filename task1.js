Qualtrics.SurveyEngine.addOnload(function() {
    // Hide the Next button immediately when the page loads
    //this.hideNextButton();
});

Qualtrics.SurveyEngine.addOnReady(function() {
    var myVideo = document.getElementById("my-video");
    var playBtn = document.getElementById("play-btn");
    var captionText = document.getElementById("video-caption");
    var qthis = this; // References the Qualtrics question context

    myVideo.addEventListener("contextmenu", function(e) {
        e.preventDefault();
    });

    //hide play button until loaded
    myVideo.addEventListener("canplay", function() {
        playBtn.style.display = "inline-block";
        captionText.innerText = "Start the video when you are ready.";
    });

    //Play video and log timestamp
    playBtn.addEventListener("click", function() {
        // Hide the play button so they can't click it again
        this.style.display = "none";
        captionText.style.display = "none";

        myVideo.play();

        if (myVideo.requestFullscreen) {
            myVideo.requestFullscreen();
        } else if (myVideo.webkitRequestFullscreen) { /* Safari */
            myVideo.webkitRequestFullscreen();
        } else if (myVideo.msRequestFullscreen) { /* IE11 */
            myVideo.msRequestFullscreen();
        }
    });

    //record time stamp when video started
    myVideo.addEventListener("playing", function() {
        let dt = moment().format('YYYY-MM-DD HH:mm:ss.SSS');
        Qualtrics.SurveyEngine.setJSEmbeddedData("trainspotting_video_started", dt);
    });

    // auto advance to next question when video completes
    myVideo.addEventListener("ended", function() {
        let dt = moment().format('YYYY-MM-DD HH:mm:ss.SSS');
        Qualtrics.SurveyEngine.setJSEmbeddedData("trainspotting_video_ended", dt);

        qthis.clickNextButton();
    });
});