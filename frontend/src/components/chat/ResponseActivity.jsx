const STAGE_LABELS = {
  routing: "Understanding your request",
  thinking: "Thinking through the answer",
  query_refinement: "Refining what to look for",
  collecting_data: "Collecting relevant data",
  building_context: "Organizing the useful details",
  generating: "Composing your response",
  calendar_details: "Reading event details",
  calendar_check: "Checking your calendar",
  calendar_slots: "Finding available times",
  calendar_confirmation: "Preparing your confirmation",
  calendar_create: "Creating your confirmed event",
  email_details: "Understanding the email",
  email_recipient: "Finding the recipient",
  email_draft: "Drafting your email",
  email_review: "Preparing it for your approval",
  email_send: "Sending your approved email",
};

const stageLabel = (stage) => STAGE_LABELS[stage] ?? "Working on your request";

export default function ResponseActivity({ activity }) {
  const stage = activity?.stage ?? "routing";
  const history = (activity?.history ?? []).slice(-3);

  return (
    <div
      className={`myra-activity-trail flow-${activity?.flow ?? "general"}`}
      role="status"
      aria-live="polite"
      aria-label={stageLabel(stage)}
    >
      <div className="myra-activity-signal" aria-hidden="true">
        <span className="myra-activity-orbit" />
        <span className="myra-activity-core" />
        <span className="myra-activity-spark" />
      </div>

      <div className="myra-activity-copy">
        <div className="myra-activity-current" key={stage}>
          <span>{stageLabel(stage)}</span>
          {activity?.detail && (
            <small>{activity.detail}</small>
          )}
        </div>

        <div className="myra-activity-rail" aria-hidden="true">
          <span className="myra-activity-light" />
        </div>

        <div className="myra-activity-history" aria-hidden="true">
          {history.map((completedStage) => (
            <span key={completedStage}>
              <i />
              {stageLabel(completedStage)}
            </span>
          ))}
          <span className="active">
            <i />
            {stageLabel(stage)}
          </span>
        </div>
      </div>
    </div>
  );
}
