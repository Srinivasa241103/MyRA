import ChatWindow from "../components/chat/ChatWindow";

function ChatPage({ onNavigate, onToggleSidebar }) {
  return (
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <ChatWindow onNavigate={onNavigate} onToggleSidebar={onToggleSidebar} />
    </div>
  );
}

export default ChatPage;
