export const profileSettingsStyles = {
  container: "min-h-screen bg-[#0D0D12] text-white",

  // Header
  header: "border-b border-[#2A2A35] bg-[#16161E]",
  headerContent: "max-w-4xl mx-auto px-6 py-4 flex items-center justify-between",
  headerLeft: "flex items-center gap-4",
  backButton: "p-2 hover:bg-[#2A2A35] rounded-lg transition text-gray-400 hover:text-white",
  headerTitle: "text-xl font-semibold",

  // Content
  content: "max-w-4xl mx-auto px-6 py-8",

  // Tabs
  tabsContainer: "flex gap-6 border-b border-[#2A2A35] mb-8",
  tab: "pb-3 px-1 font-medium transition",
  tabActive: "text-white border-b-2 border-purple-500",
  tabInactive: "text-gray-400 hover:text-gray-200",

  // Sections
  section: "space-y-6",
  card: "bg-[#16161E] rounded-xl p-6 border border-[#2A2A35]",
  cardTitle: "text-lg font-semibold mb-4",

  // Form elements
  formGroup: "space-y-4",
  label: "block text-sm font-medium text-gray-400 mb-2",
  input: "w-full px-4 py-2 bg-[#0D0D12] border border-[#2A2A35] rounded-lg focus:outline-none focus:border-purple-500 transition-colors text-white",
  select: "w-full px-4 py-2 bg-[#0D0D12] border border-[#2A2A35] rounded-lg focus:outline-none focus:border-purple-500 transition-colors text-white",

  // Buttons
  buttonPrimary: "flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition font-medium",
  buttonDanger: "px-4 py-2 bg-red-900/20 hover:bg-red-900/30 text-red-400 border border-red-900/50 rounded-lg transition font-medium",
  buttonFull: "w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-[#2A2A35] disabled:cursor-not-allowed rounded-lg transition font-medium flex items-center justify-center gap-2",
  buttonRefresh: "text-sm text-purple-400 hover:text-purple-300 transition",

  // Danger zone
  dangerZoneTitle: "text-lg font-semibold mb-2 text-red-400",
  dangerZoneText: "text-sm text-gray-400 mb-4",

  // Accounts
  selectGroup: "mb-6",

  // Sync history
  historyHeader: "flex items-center justify-between mb-4",
  historyEmpty: "text-center py-8 text-gray-500",
  historyLoading: "text-center py-8 text-gray-500",
  historyList: "space-y-3",

  // Sync item
  syncItem: "bg-[#0D0D12] rounded-lg p-4 border border-[#2A2A35]",
  syncItemHeader: "flex items-center justify-between mb-2",
  syncItemLeft: "flex items-center gap-3",
  syncItemIcon: "text-2xl",
  syncItemInfo: "",
  syncItemName: "font-medium capitalize",
  syncItemDate: "text-xs text-gray-500",

  // Status badges
  statusBadge: "px-3 py-1 rounded-full text-xs font-medium",
  statusSuccess: "bg-green-500/20 text-green-400 border border-green-500/30",
  statusInProgress: "bg-purple-500/20 text-purple-400 border border-purple-500/30",
  statusFailed: "bg-red-500/20 text-red-400 border border-red-500/30",

  // Sync details
  syncDetails: "grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-[#2A2A35]",
  syncDetailItem: "",
  syncDetailLabel: "text-xs text-gray-500",
  syncDetailValue: "text-sm font-medium",

  // Error message
  errorMessage: "mt-3 p-2 bg-red-900/20 border border-red-900/50 rounded text-xs text-red-400",

  // Spinner
  spinner: "animate-spin h-5 w-5",
};
