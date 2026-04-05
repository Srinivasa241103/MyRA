const calendarAgentState = {
  userId: {
    value: (x, y) => y ?? x,
    default: () => null,
  },

  userMessage: {
    value: (x, y) => y ?? x,
    default: () => "",
  },

  eventDetails: {
    // null resets the whole object (new event flow); object merges incrementally
    value: (x, y) => (y === null ? { title: null, date: null, startTime: null, endTime: null, description: null, attendees: [], location: null } : { ...x, ...y }),
    default: () => ({
      title: null,
      date: null,
      startTime: null,
      endTime: null,
      description: null,
      attendees: [],
      location: null,
    }),
  },

  missingFields: {
    value: (x, y) => (y !== undefined ? y : x),
    default: () => [],
  },

  conflicts: {
    value: (x, y) => (y !== undefined ? y : x),
    default: () => [],
  },

  suggestedSlots: {
    value: (x, y) => (y !== undefined ? y : x),
    default: () => [],
  },

  confirmationStatus: {
    // Allow explicit null to reset (y ?? x would keep old value when y is null)
    value: (x, y) => (y !== undefined ? y : x),
    default: () => null,
  },

  responseToUser: {
    value: (x, y) => y ?? x,
    default: () => null,
  },

  messages: {
    value: (x, y) => x.concat(y),
    default: () => [],
  },
};

export default calendarAgentState;
