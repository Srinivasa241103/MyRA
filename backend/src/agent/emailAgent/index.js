import { Command } from "@langchain/langgraph";
import { emailAgent } from "./graph.js";

const pendingTimers = new Map();
const sessionOperations = new Map();

const runSerialized = async (threadId, operation) => {
    const previous = sessionOperations.get(threadId) ?? Promise.resolve();
    const current = previous
        .catch(() => {})
        .then(operation);

    sessionOperations.set(threadId, current);

    try {
        return await current;
    } finally {
        if (sessionOperations.get(threadId) === current) {
            sessionOperations.delete(threadId);
        }
    }
};

const getConfig = (
    conversationId,
    userId = null,
    llmProvider = null,
    model = null
) => ({
    configurable: {
        thread_id: `secure_email_${userId ?? "anonymous"}_${conversationId}`,
        user_id: userId,
        llmProvider,
        model,
    },
});

const getInterrupt = (snapshot) => {
    return snapshot?.tasks
        ?.flatMap(task => task.interrupts ?? [])
        ?.at(0)
        ?.value ?? null;
};

const clearPendingTimer = (threadId) => {
    const timer = pendingTimers.get(threadId);
    if (timer) clearTimeout(timer);
    pendingTimers.delete(threadId);
};

const schedulePendingSend = ({ conversationId, userId, payload }) => {
    const config = getConfig(conversationId, userId);
    const threadId = config.configurable.thread_id;
    clearPendingTimer(threadId);

    const delay = Math.max(0, Date.parse(payload.deadline) - Date.now());
    const timer = setTimeout(async () => {
        pendingTimers.delete(threadId);

        try {
            await runSerialized(threadId, async () => {
                const snapshot = await emailAgent.getState(config);
                const currentInterrupt = getInterrupt(snapshot);
                const stillPending = snapshot.values?.send_status === "pending_revoke"
                    && snapshot.values?.pending_send_token === payload.token
                    && currentInterrupt?.type === "pending_send";

                if (!stillPending) return;

                await emailAgent.invoke(
                    new Command({
                        resume: { action: "timeout", token: payload.token },
                    }),
                    config
                );
            });
        } catch (error) {
            console.error("[emailAgent] Delayed send failed:", error.message);
        }
    }, delay);

    pendingTimers.set(threadId, timer);
};

const isRevokeResponse = (value) => {
    const action = typeof value === "string"
        ? value
        : value?.action;

    return ["revoke", "undo", "cancel", "stop"].includes(
        action?.trim().toLowerCase()
    );
};

const invokeEmailAgent = async (
    userMessage,
    conversationId,
    intent = null,
    userId = null,
    resumeValue = null,
    llmProvider = null,
    model = null
) => {
    const config = getConfig(conversationId, userId, llmProvider, model);
    const threadId = config.configurable.thread_id;
    const isResume = resumeValue !== null && resumeValue !== undefined;

    if (isResume && isRevokeResponse(resumeValue)) {
        clearPendingTimer(threadId);
    }

    return runSerialized(threadId, async () => {
        const input = isResume
            ? new Command({ resume: resumeValue })
            : {
                user_prompt: userMessage,
                llm_provider: llmProvider,
                llm_model: model,
            };

        let finalState = null;
        for await (const event of await emailAgent.stream(input, {
            ...config,
            streamMode: "values",
        })) {
            finalState = event;
        }

        const snapshot = await emailAgent.getState(config);
        const interruptPayload = getInterrupt(snapshot);

        if (interruptPayload?.type === "pending_send") {
            schedulePendingSend({ conversationId, userId, payload: interruptPayload });
        }

        if (interruptPayload) {
            return {
                agentResponse: interruptPayload,
                emailResponse: interruptPayload,
                status: "interrupted",
                emailStatus: snapshot.values?.send_status ?? "not_started",
            };
        }

        clearPendingTimer(threadId);

        return {
            agentResponse: finalState?.final_response ?? "Email workflow completed.",
            emailResponse: null,
            status: "complete",
            emailStatus: finalState?.send_status ?? "not_started",
        };
    });
};

const revokePendingSend = async (conversationId, userId = null) => {
    const config = getConfig(conversationId, userId);
    const threadId = config.configurable.thread_id;
    clearPendingTimer(threadId);

    return runSerialized(threadId, () => emailAgent.invoke(
        new Command({ resume: { action: "revoke" } }),
        config
    ));
};

const getEmailSessionState = async (conversationId, userId = null) => {
    const snapshot = await emailAgent.getState(getConfig(conversationId, userId));
    return snapshot?.values ?? null;
};

const getEmailSessionStatus = async (conversationId, userId = null) => {
    const config = getConfig(conversationId, userId);
    const snapshot = await emailAgent.getState(config);
    const values = snapshot?.values ?? null;
    const interruptPayload = getInterrupt(snapshot);

    if (!values) {
        return {
            exists: false,
            active: false,
            emailStatus: "not_started",
            response: null,
            interrupt: null,
        };
    }

    return {
        exists: true,
        active: Boolean(interruptPayload) || (snapshot.next?.length ?? 0) > 0,
        emailStatus: values.send_status,
        response: values.final_response,
        interrupt: interruptPayload,
        revokeDeadline: values.revoke_deadline,
    };
};

const hasActiveEmailSession = async (conversationId, userId = null) => {
    const snapshot = await emailAgent.getState(getConfig(conversationId, userId));
    if (!snapshot) return false;

    return Boolean(getInterrupt(snapshot)) || (snapshot.next?.length ?? 0) > 0;
};

export {
    getEmailSessionState,
    getEmailSessionStatus,
    hasActiveEmailSession,
    invokeEmailAgent,
    revokePendingSend,
};
