import { route, paging, body, str } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { createTask } from "@/lib/core/tasks";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ caller, search }) => {
  const { limit, offset } = paging(search);
  const where = { tenantId: caller.tenantId };
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where, orderBy: { createdAt: "desc" }, take: limit, skip: offset,
      select: { id: true, title: true, status: true, dueAt: true, createdAt: true },
    }),
    prisma.task.count({ where }),
  ]);
  return { tasks, total, limit, offset };
});

export const POST = route({ capability: "task:manage", mutates: true }, async ({ caller, req }) => {
  const input = await body(req);
  const due = str(input, "dueAt");
  const task = await createTask({
    tenantId: caller.tenantId,
    title: str(input, "title", true)!,
    dueAt: due ? new Date(due) : undefined,
  });
  return { task: { id: task.id, title: task.title } };
});
