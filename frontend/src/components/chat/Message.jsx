function Message({ role, text, isError, context }) {
  const isUser = role === "user";

  const formatTime = (date) =>
    date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  if (isUser) {
    return (
      <div className="myra-fade-in" style={{ alignSelf: "flex-end", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        <div className="myra-bubble user">
          {text}
        </div>
        <span style={{ fontSize: 11, color: "var(--text-soft)", paddingRight: 4 }}>
          {formatTime(new Date())}
        </span>
      </div>
    );
  }

  return (
    <div className="myra-fade-in" style={{ alignSelf: "flex-start", display: "flex", flexDirection: "column", gap: 4 }}>
      <div className={"myra-bubble assistant" + (isError ? " error" : "")}>
        <div>{text}</div>

        {/* Source documents */}
        {context && context.selectedDocuments > 0 && (
          <div className="src-row">
            <span className="myra-source-pill">
              <span className="dot" />
              {context.selectedDocuments} document{context.selectedDocuments !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", paddingLeft: 4 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatTime(new Date())}</span>

      </div>
    </div>
  );
}

export default Message;
