function TypingIndicator() {
  return (
    <div className="myra-fade-in" style={{ alignSelf: "flex-start" }}>
      <div className="myra-bubble assistant" style={{ padding: "12px 16px" }}>
        <div className="myra-typing-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

export default TypingIndicator;
