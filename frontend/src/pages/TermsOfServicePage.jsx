const LAST_UPDATED = "July 29, 2026";

const acceptableUseItems = [
  "Do not use MyRA to violate laws, infringe rights, send spam, distribute malware, or abuse Google services.",
  "Do not attempt to access another user's account, data, tokens, conversations, emails, calendar events, or connected services.",
  "Do not interfere with MyRA's systems, reverse engineer non-public parts of the service, or bypass security controls.",
  "Do not use MyRA to generate, send, or schedule harmful, deceptive, harassing, or unlawful content.",
];

const googleFeatureItems = [
  "Read Gmail messages and metadata you authorize so MyRA can search, summarize, and retrieve information for you.",
  "Draft, save, or send Gmail messages when you request or approve that action.",
  "Read Google Calendar events and availability so MyRA can answer schedule questions and find time slots.",
  "Create or update Google Calendar events when you request or approve that action.",
];

function TermsOfServicePage({ onNavigate }) {
  const termsUrl =
    typeof window !== "undefined" ? `${window.location.origin}/terms` : "/terms";

  const handleNavigate = (event, page) => {
    event.preventDefault();
    onNavigate(page);
  };

  return (
    <div className="myra-page-inner myra-legal-page" style={{ paddingTop: 36, paddingBottom: 56, maxWidth: 980 }}>
      <div style={{ marginBottom: 28 }}>
        <div className="myra-label" style={{ marginBottom: 8 }}>Terms of Service</div>
        <h1 className="display lg" style={{ marginBottom: 10 }}>MyRA Terms of Service</h1>
        <p className="muted" style={{ fontSize: 14 }}>
          Last updated: {LAST_UPDATED}
        </p>
      </div>

      <div className="myra-card" style={{ marginBottom: 18 }}>
        <p style={{ color: "var(--text-2)", fontSize: 15 }}>
          These Terms of Service govern your access to and use of MyRA, a personal AI retrieval assistant
          that helps you search, summarize, draft, and act on information from the Google services and other
          sources you choose to connect.
        </p>
      </div>

      <section className="myra-legal-section">
        <h2>Terms URL</h2>
        <p>
          The public Terms of Service URL for this frontend is{" "}
          <a href="/terms" onClick={(event) => handleNavigate(event, "terms")}>{termsUrl}</a>.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Acceptance</h2>
        <p>
          By accessing or using MyRA, you agree to these terms. If you do not agree, do not use the app.
          If you use MyRA on behalf of an organization, you represent that you have authority to bind that
          organization to these terms.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>What MyRA does</h2>
        <p>
          MyRA provides personal assistant features such as retrieval, summarization, chat, email drafting,
          email sending, calendar search, and calendar scheduling. Features may change over time as the app
          is improved.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Accounts and connected services</h2>
        <p>
          You are responsible for maintaining control of your account and any connected Google account.
          MyRA can only access Google services after you grant OAuth permissions. You may revoke access
          through your Google Account permissions page or disconnect supported sources inside MyRA where
          available.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Google-powered features</h2>
        <p>When you grant the relevant permissions, MyRA may help you with these Google-related actions:</p>
        <ul>
          {googleFeatureItems.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p>
          MyRA will use Google user data only to provide user-facing features you request or approve, as
          described in the Privacy Policy.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Your content</h2>
        <p>
          You retain ownership of the prompts, messages, email content, calendar content, and other materials
          you provide or authorize MyRA to access. You grant MyRA a limited permission to process that content
          only as needed to provide, secure, debug, and improve the app's user-facing functionality.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>AI outputs</h2>
        <p>
          MyRA may generate drafts, summaries, suggestions, search results, and calendar recommendations.
          AI output can be incomplete, inaccurate, or unsuitable for your situation. You are responsible for
          reviewing output before relying on it, sending it, scheduling it, or sharing it.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Acceptable use</h2>
        <ul>
          {acceptableUseItems.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section className="myra-legal-section">
        <h2>Third-party services</h2>
        <p>
          MyRA integrates with third-party services such as Google APIs, hosting providers, databases, and AI
          model providers. Those services may have their own terms and policies. MyRA is not responsible for
          third-party services outside its control.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Service availability</h2>
        <p>
          MyRA is provided on an as-is and as-available basis. The service may be interrupted, changed,
          suspended, or discontinued. MyRA does not guarantee that any feature will be available, error-free,
          secure, or uninterrupted.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Suspension and termination</h2>
        <p>
          Access may be limited, suspended, or terminated if you violate these terms, create security or legal
          risk, abuse the service, or if continued operation of an account becomes impractical.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, MyRA will not be liable for indirect, incidental, special,
          consequential, exemplary, or punitive damages, or for lost profits, lost data, or business interruption
          arising from your use of the app.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Privacy</h2>
        <p>
          MyRA's handling of personal data and Google user data is described in the{" "}
          <a href="/privacy" onClick={(event) => handleNavigate(event, "privacy")}>Privacy Policy</a>.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Changes to these terms</h2>
        <p>
          MyRA may update these terms as the app, providers, or legal requirements change. Continued use of
          the app after updated terms are posted means you accept the updated terms.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Contact</h2>
        <p>
          For questions about these terms, contact the developer through the support contact listed for MyRA
          in the Google OAuth consent screen and app publishing profile.
        </p>
      </section>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 24 }}>
        <a className="myra-btn secondary" href="/" onClick={(event) => handleNavigate(event, "home")}>
          Back to Home
        </a>
        <a className="myra-btn ghost" href="/privacy" onClick={(event) => handleNavigate(event, "privacy")}>
          Privacy Policy
        </a>
      </div>
    </div>
  );
}

export default TermsOfServicePage;
