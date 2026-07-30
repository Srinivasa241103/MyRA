import ChatWindow from "../components/chat/ChatWindow";

function ChatPage({ onNavigate, onToggleSidebar, theme, onThemeChange }) {
  return (
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <ChatWindow
        onNavigate={onNavigate}
        onToggleSidebar={onToggleSidebar}
        theme={theme}
        onThemeChange={onThemeChange}
      />
    </div>
  );
}

export default ChatPage;
