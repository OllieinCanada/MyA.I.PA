// Only a visible browser may send the existing signed confirmation POST.
// Keep the progress page visible while providers finish; never navigate away
// to forwarding or wait for a separate SMS to display the returned number.
function verificationPageClientScript({ automaticSmsConfirmation = false } = {}) {
  return `<script>
    (() => {
      const form = document.getElementById("signup-verification-form");
      if (!form) return;
      let submitted = false;
      const progress = document.getElementById("setup-progress");
      async function continueSignup(event) {
        if (event) event.preventDefault();
        if (submitted || document.visibilityState !== "visible") return;
        submitted = true;
        progress.hidden = false;
        form.querySelectorAll("button").forEach(button => { button.disabled = true; });
        document.getElementById("verification-title").textContent = "Setting up your assistant";
        document.getElementById("verification-description").textContent = "Keep this page open. Your AI number will appear here when assignment finishes.";
        try {
          const response = await fetch(form.action, {
            method: "POST", credentials: "same-origin", redirect: "error",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" },
            body: new URLSearchParams(new FormData(form)).toString()
          });
          if (!(response.headers.get("content-type") || "").includes("text/html")) throw new Error("Setup response unavailable");
          const html = await response.text();
          const result = new DOMParser().parseFromString(html, "text/html");
          if (!result.querySelector("main")) throw new Error("Setup page unavailable");
          // Server-rendered result, including Call/Copy/Continue, replaces this
          // page at the same URL. No numbers or tokens go into browser storage.
          document.open(); document.write(html); document.close();
        } catch (_) {
          progress.hidden = true;
          document.getElementById("verification-title").textContent = "We couldn’t confirm setup yet";
          document.getElementById("verification-description").textContent = "Your details are saved. Contact support to check this signup—don’t submit another one.";
          form.hidden = true;
        }
      }
      form.addEventListener("submit", continueSignup);
      ${automaticSmsConfirmation ? 'document.addEventListener("visibilitychange", () => continueSignup()); continueSignup();' : ''}
    })();
  </script>`;
}

module.exports = { verificationPageClientScript };
