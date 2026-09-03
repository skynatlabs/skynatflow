// Goal tracking — deliberately manual-update, not auto-tied to a metric
// pipeline, matching the same "must be easy to use, not a suite" stance
// as the rest of the platform (see Task model's comment for the same call).

import { GoalStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function createGoal(params: {
  tenantId: string;
  ownerId?: string;
  title: string;
  metricLabel: string;
  targetValue: number;
  dueDate?: Date;
}) {
  return prisma.goal.create({ data: params });
}

export async function updateGoalProgress(goalId: string, currentValue: number) {
  const goal = await prisma.goal.findUniqueOrThrow({ where: { id: goalId } });
  const status: GoalStatus =
    currentValue >= goal.targetValue
      ? "ACHIEVED"
      : goal.dueDate && goal.dueDate < new Date()
        ? "MISSED"
        : currentValue / goal.targetValue < 0.5 && goal.dueDate && daysUntil(goal.dueDate) < 14
          ? "AT_RISK"
          : "ON_TRACK";

  return prisma.goal.update({ where: { id: goalId }, data: { currentValue, status } });
}

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

export async function listGoals(tenantId: string) {
  return prisma.goal.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 200 });
}
