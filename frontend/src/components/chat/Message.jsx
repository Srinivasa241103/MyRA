import { useAuthStore } from "../../store/authStore";

const SparklesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
  </svg>
);

function Message({ role, text, isError, context }) {
  const isUser = role === "user";
  const { user } = useAuthStore();

  const getInitials = (name) => {
    if (!name) return "ME";
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  };

  const formatTime = (date) =>
    date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  return (
    <div className={`flex gap-4 animate-fade-in ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div className="flex-shrink-0">
        {isUser ? (
          user?.picture ? (
            <img
              src={user.picture}
              alt={user.name || "You"}
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-xs font-medium">
              {getInitials(user?.name)}
            </div>
          )
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <SparklesIcon />
          </div>
        )}
      </div>

      {/* Bubble */}
      <div className={`flex-1 ${isUser ? "flex justify-end" : ""}`}>
        <div
          className={`inline-block max-w-[85%] rounded-2xl px-4 py-3 ${
            isUser
              ? `bg-[#5B5BD6] text-white ${isError ? "bg-red-900/30 border border-red-500/40" : ""}`
              : "bg-[#16161E] text-gray-100"
          }`}
          style={{ whiteSpace: "pre-wrap" }}
        >
          {text}
          <span className={`text-xs mt-2 block ${isUser ? "text-purple-200" : "text-gray-500"}`}>
            {formatTime(new Date())}
          </span>
        </div>
        {!isUser && context && context.selectedDocuments > 0 && (
          <p className="text-xs text-gray-600 mt-1 px-2">
            Based on {context.selectedDocuments} document{context.selectedDocuments !== 1 ? "s" : ""}
          </p>
        )}
      </div>
    </div>
  );
}

export default Message;
