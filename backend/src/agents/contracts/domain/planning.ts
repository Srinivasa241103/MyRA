import { z } from "zod";
import { SupportedFlowSchema } from "../flowContracts.js";
import {
  AgentCapabilitySchema,
  DomainSchemaVersionSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  JsonObjectSchema,
  UserIdSchema,
} from "./common.js";

export const PlannedSubtaskSchema = z.object({
  schemaVersion: DomainSchemaVersionSchema,
  id: IdentifierSchema,
  runId: IdentifierSchema,
  userId: UserIdSchema,
  capability: AgentCapabilitySchema,
  description: z.string().trim().min(1),
  dependsOn: z.array(IdentifierSchema).default([]),
  allowedTools: z.array(IdentifierSchema).default([]),
  requiredOutput: JsonObjectSchema,
  successCriteria: z.array(z.string().trim().min(1)).min(1),
}).strict().superRefine((subtask, context) => {
  if (subtask.dependsOn.includes(subtask.id)) {
    context.addIssue({
      code: "custom",
      path: ["dependsOn"],
      message: "A subtask cannot depend on itself",
    });
  }
  if (new Set(subtask.dependsOn).size !== subtask.dependsOn.length) {
    context.addIssue({
      code: "custom",
      path: ["dependsOn"],
      message: "Subtask dependencies must be unique",
    });
  }
});

export const PlanSchema = z.object({
  schemaVersion: DomainSchemaVersionSchema,
  id: IdentifierSchema,
  runId: IdentifierSchema,
  userId: UserIdSchema,
  flow: SupportedFlowSchema,
  revision: z.number().int().positive(),
  objective: z.string().trim().min(1),
  subtasks: z.array(PlannedSubtaskSchema).min(1),
  createdAt: IsoDateTimeSchema,
  metadata: JsonObjectSchema.default({}),
}).strict().superRefine((plan, context) => {
  const subtaskIds = new Set<string>();

  for (const [index, subtask] of plan.subtasks.entries()) {
    if (subtask.runId !== plan.runId) {
      context.addIssue({
        code: "custom",
        path: ["subtasks", index, "runId"],
        message: "Subtask run scope must match its plan",
      });
    }
    if (subtask.userId !== plan.userId) {
      context.addIssue({
        code: "custom",
        path: ["subtasks", index, "userId"],
        message: "Subtask user scope must match its plan",
      });
    }
    if (subtaskIds.has(subtask.id)) {
      context.addIssue({
        code: "custom",
        path: ["subtasks", index, "id"],
        message: "Subtask IDs must be unique within a plan",
      });
    }
    subtaskIds.add(subtask.id);
  }

  for (const [index, subtask] of plan.subtasks.entries()) {
    for (const dependency of subtask.dependsOn) {
      if (!subtaskIds.has(dependency)) {
        context.addIssue({
          code: "custom",
          path: ["subtasks", index, "dependsOn"],
          message: `Unknown subtask dependency: ${dependency}`,
        });
      }
    }
  }
});

export type PlannedSubtask = z.infer<typeof PlannedSubtaskSchema>;
export type Plan = z.infer<typeof PlanSchema>;
