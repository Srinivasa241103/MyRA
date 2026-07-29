const LAST_UPDATED = "July 29, 2026";

const googleDataItems = [
  "Google account profile information such as your name, email address, profile photo, Google account ID, locale, and email verification status.",
  "Gmail data that you authorize MyRA to access, including message IDs, thread IDs, labels, snippets, sender and recipient headers, subjects, dates, and email body text.",
  "Gmail draft and send details when you ask MyRA to draft, save, or send an email, including recipients, subject, message body, thread references, and delivery status.",
  "Google Calendar data that you authorize MyRA to access, including event titles, descriptions, locations, start and end times, attendees, organizers, recurrence details, conference data, links, and free/busy information.",
];

const useItems = [
  "Authenticate you and keep your account connected to the Google services you choose.",
  "Sync, index, and retrieve your Gmail and Calendar information so MyRA can answer your questions about your inbox and schedule.",
  "Summarize, search, and organize your personal information in response to your prompts.",
  "Draft, save, or send emails only when you request or approve that action.",
  "Create, update, review, or schedule calendar events only when you request that action.",
  "Show account, sync, activity, and connection status inside the app.",
  "Maintain security, debug failures, prevent abuse, and comply with legal obligations.",
];

const shareItems = [
  "Infrastructure providers that host the app, databases, logs, and related systems.",
  "AI model and processing providers when needed to generate a response, draft, summary, retrieval result, or user-directed action.",
  "Google APIs when MyRA authenticates, syncs data, sends email, saves drafts, or manages calendar events at your direction.",
  "Authorities or other parties when disclosure is required by law, security, abuse prevention, or an enforceable legal process.",
];

function PrivacyPolicyPage({ onNavigate }) {
  const privacyUrl =
    typeof window !== "undefined" ? `${window.location.origin}/privacy` : "/privacy";

  const handleNavigate = (event, page) => {
    event.preventDefault();
    onNavigate(page);
  };

  return (
    <div className="myra-page-inner myra-legal-page" style={{ paddingTop: 36, paddingBottom: 56, maxWidth: 980 }}>
      <div style={{ marginBottom: 28 }}>
        <div className="myra-label" style={{ marginBottom: 8 }}>Privacy Policy</div>
        <h1 className="display lg" style={{ marginBottom: 10 }}>MyRA Privacy Policy</h1>
        <p className="muted" style={{ fontSize: 14 }}>
          Last updated: {LAST_UPDATED}
        </p>
      </div>

      <div className="myra-card" style={{ marginBottom: 18 }}>
        <p style={{ color: "var(--text-2)", fontSize: 15 }}>
          MyRA is a personal AI retrieval assistant that helps you search, summarize, draft, and act on
          information from the Google services you choose to connect. This policy explains how MyRA
          accesses, uses, stores, shares, protects, retains, and deletes Google user data and related app data.
        </p>
      </div>

      <section className="myra-legal-section">
        <h2>Privacy policy URL</h2>
        <p>
          The public privacy policy URL for this frontend is{" "}
          <a href="/privacy" onClick={(event) => handleNavigate(event, "privacy")}>{privacyUrl}</a>.
          The same URL should be linked from the Google OAuth consent screen.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Google data MyRA accesses</h2>
        <p>
          MyRA only accesses Google user data after you sign in with Google and grant the requested OAuth
          permissions. Depending on the permissions you approve and the features you use, MyRA may access:
        </p>
        <ul>
          {googleDataItems.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section className="myra-legal-section">
        <h2>Other app data MyRA collects</h2>
        <p>
          MyRA may also collect information you provide directly in the app, such as prompts, chat messages,
          account preferences, sync actions, connection status, generated drafts, generated event details,
          and operational logs needed to run and secure the service.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>How MyRA uses Google user data</h2>
        <p>MyRA uses Google user data only to provide and improve user-facing features that are visible in the app:</p>
        <ul>
          {useItems.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section className="myra-legal-section">
        <h2>Limited Use commitment</h2>
        <p>
          MyRA's use and transfer of information received from Google APIs will adhere to the Google API
          Services User Data Policy, including the Limited Use requirements. MyRA does not sell Google user
          data, use it for advertising, transfer it to data brokers or information resellers, use it to determine
          credit-worthiness or for lending, or use it to train or improve generalized AI or machine learning models.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>How MyRA stores and protects data</h2>
        <p>
          MyRA stores connected account records, OAuth tokens, synced documents, embeddings, chat history,
          and sync logs in backend systems. OAuth access and refresh tokens are encrypted before storage.
          Access to user data is limited to systems and personnel needed to operate, secure, debug, or support
          the app. MyRA uses reasonable safeguards designed to protect data in transit and at rest.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>How MyRA shares data</h2>
        <p>
          MyRA does not sell your personal data or Google user data. MyRA may share or transfer data only as
          needed for these purposes:
        </p>
        <ul>
          {shareItems.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p>
          Service providers are permitted to process data only to provide the requested app functionality,
          security, hosting, support, or legal compliance functions.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Human access</h2>
        <p>
          MyRA does not allow humans to read your Google user data except when you explicitly ask for support
          involving specific data, when necessary for security or abuse investigation, when required by law,
          or when data has been aggregated and anonymized for internal operations.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Retention and deletion</h2>
        <p>
          MyRA keeps Google user data only as long as needed to provide the connected features, maintain your
          account, meet legal obligations, resolve disputes, prevent abuse, and operate the service. You can
          disconnect Google access from your Google Account permissions page. You may also request deletion of
          your MyRA account data from the app's profile or privacy settings where available. After deletion or
          disconnection, MyRA will delete or de-identify stored data unless retention is required for legal,
          security, backup, or fraud-prevention reasons.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Your choices</h2>
        <ul>
          <li>You can choose not to connect Google services or can revoke OAuth access in your Google Account.</li>
          <li>You can use guest mode for chats that do not save chat history.</li>
          <li>You can request export or deletion of account data from MyRA's privacy settings where available.</li>
        </ul>
      </section>

      <section className="myra-legal-section">
        <h2>Changes to this policy</h2>
        <p>
          MyRA may update this policy when app functionality, data practices, providers, or legal requirements
          change. If MyRA materially changes how it uses Google user data, users will be notified and asked to
          consent where required before the new use applies.
        </p>
      </section>

      <section className="myra-legal-section">
        <h2>Contact</h2>
        <p>
          For privacy questions or deletion requests, contact the developer through the support contact listed
          for MyRA in the Google OAuth consent screen and app publishing profile.
        </p>
      </section>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 24 }}>
        <a className="myra-btn secondary" href="/" onClick={(event) => handleNavigate(event, "home")}>
          Back to Home
        </a>
        <a className="myra-btn ghost" href="/settings" onClick={(event) => handleNavigate(event, "settings")}>
          Privacy Settings
        </a>
        <a className="myra-btn ghost" href="/terms" onClick={(event) => handleNavigate(event, "terms")}>
          Terms of Service
        </a>
      </div>
    </div>
  );
}

export default PrivacyPolicyPage;
