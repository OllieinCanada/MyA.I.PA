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
        document.dispatchEvent(new Event("signup-verification-started"));
        progress.hidden = false;
        form.querySelectorAll("button").forEach(button => { button.disabled = true; });
        document.getElementById("verification-title").textContent = "Setting up your assistant";
        document.getElementById("verification-description").textContent = "Keep this page open. Your AI number will appear above when assignment finishes. This may take a few minutes.";
        try {
          const response = await fetch(form.action, {
            method: "POST", credentials: "same-origin", redirect: "error",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" },
            body: new URLSearchParams(new FormData(form)).toString()
          });
          if (!(response.headers.get("content-type") || "").includes("text/html")) throw new Error("Setup response unavailable");
          const html = await response.text();
          const result = new DOMParser().parseFromString(html, "text/html");
          if (!result.querySelector("main #verification-title")) throw new Error("Setup page unavailable");
          // Server-rendered result, including Call/Copy/Continue, replaces this
          // page at the same URL. No numbers or tokens go into browser storage.
          document.open(); document.write(html); document.close();
        } catch (_) {
          document.dispatchEvent(new Event("signup-verification-problem"));
          progress.hidden = true;
          document.getElementById("verification-title").textContent = "Checking your saved setup";
          document.getElementById("verification-description").textContent = "The setup response was interrupted. We’re checking saved progress automatically—don’t submit another signup.";
          form.hidden = true;
          const support = document.getElementById("verification-support");
          if (support) support.hidden = false;
        }
      }
      form.addEventListener("submit", continueSignup);
      ${automaticSmsConfirmation ? 'document.addEventListener("visibilitychange", () => continueSignup()); continueSignup();' : ''}
    })();
  </script>`;
}

module.exports = { verificationPageClientScript };
