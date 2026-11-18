import { buildFeedbackDashboardUrl } from "../../_helpers/build-feedback-dashboard-url";
import { ClickUpRequestError } from "./clickup-request-error";
import { prisma } from "@workspace/db";
import { inngest } from "@/server/inngest";
import { feedbackCreatedEvent } from "@/server/inngest/events";

// Maps a Project's publicId to a ClickUp List id, e.g.
// CLICKUP_LIST_MAP={"proj_abc":"901100111"}. A Project without an entry is skipped.
function resolveListId(projectPublicId: string): string | null {
  try {
    const map = JSON.parse(process.env.CLICKUP_LIST_MAP ?? "{}") as Record<
      string,
      string
    >;
    return map[projectPublicId] ?? null;
  } catch {
    console.warn(
      "[clickup] CLICKUP_LIST_MAP is not valid JSON, skipping ClickUp task creation.",
    );
    return null;
  }
}

export const createClickUpTask = inngest.createFunction(
  {
    id: "create-clickup-task",
    retries: 3,
    concurrency: { key: "event.data.feedbackId", limit: 1 },
    triggers: [{ event: feedbackCreatedEvent }],
  },
  async ({ event, step }) => {
    const token = process.env.CLICKUP_API_TOKEN;
    if (!token) return { skipped: "clickup_not_configured" };

    const feedback = await prisma.feedback.findUnique({
      where: { id: event.data.feedbackId },
      include: {
        reviewer: { select: { name: true } },
        project: { select: { name: true, publicId: true } },
      },
    });
    if (!feedback) return { skipped: "feedback_not_found" };

    const listId = resolveListId(feedback.project.publicId);
    if (!listId) return { skipped: "no_clickup_list" };

    const comment = feedback.comment.trim();
    const title = comment
      ? `[${feedback.project.name}] ${comment.slice(0, 80)}`
      : `[${feedback.project.name}] New feedback`;

    const description = [
      comment,
      feedback.pageUrl ? `Page: ${feedback.pageUrl}` : null,
      `Reported by: ${feedback.reviewer.name}`,
      `Feedback: ${buildFeedbackDashboardUrl(feedback)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    // A step memoizes the result, so an Inngest retry after success never duplicates the task.
    const task = await step.run("create-task", async () => {
      const response = await fetch(
        `https://api.clickup.com/api/v2/list/${listId}/task`,
        {
          method: "POST",
          headers: { Authorization: token, "Content-Type": "application/json" },
          body: JSON.stringify({ name: title, description }),
        },
      );
      // Throwing lets Inngest retry transient failures.
      if (!response.ok) {
        throw new ClickUpRequestError(`ClickUp responded ${response.status}`);
      }
      return (await response.json()) as { id: string };
    });

    return { created: true, taskId: task.id };
  },
);
