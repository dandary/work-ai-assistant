import type { Prisma } from "@prisma/client";

type TurnMessage = { role: "user" | "assistant"; content: string };

function messagesMatch(a: TurnMessage[], b: TurnMessage[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => m.role === b[i]?.role && m.content === b[i]?.content);
}

/** Сохраняет ход диалога: по возможности только новую пару user+assistant. */
export async function persistConversationTurn(
  tx: Prisma.TransactionClient,
  conversationId: string,
  incoming: TurnMessage[],
  assistantContent: string,
  meta: {
    presetId: string;
    modelId: string;
    newTitle?: string;
    refreshSummary?: boolean;
  },
): Promise<void> {
  const stored = await tx.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  const storedTurn: TurnMessage[] = stored.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const lastIncoming = incoming[incoming.length - 1];
  const canAppend =
    lastIncoming?.role === "user" &&
    incoming.length === storedTurn.length + 1 &&
    messagesMatch(storedTurn, incoming.slice(0, storedTurn.length));

  const fullTurn: TurnMessage[] = [
    ...incoming,
    { role: "assistant", content: assistantContent },
  ];

  if (canAppend) {
    await tx.message.createMany({
      data: [
        {
          conversationId,
          role: "user",
          content: lastIncoming.content,
        },
        {
          conversationId,
          role: "assistant",
          content: assistantContent,
        },
      ],
    });
  } else {
    await tx.message.deleteMany({ where: { conversationId } });
    await tx.message.createMany({
      data: fullTurn.map((m) => ({
        conversationId,
        role: m.role,
        content: m.content,
      })),
    });
  }

  const updateData: Prisma.ConversationUpdateInput = {
    preset: meta.presetId,
    modelId: meta.modelId,
    ...(meta.newTitle ? { title: meta.newTitle } : {}),
  };

  if (meta.refreshSummary) {
    const total = await tx.message.count({ where: { conversationId } });
    if (total >= 12) {
      const recent = await tx.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { role: true, content: true },
      });
      const chronological = [...recent].reverse();
      const summary = chronological
        .map((m) => {
          const tag = m.role === "user" ? "П" : "А";
          return `${tag}: ${m.content.replace(/\s+/g, " ").trim().slice(0, 280)}`;
        })
        .join("\n")
        .slice(0, 2000);
      updateData.summary = summary;
    }
  }

  await tx.conversation.update({
    where: { id: conversationId },
    data: updateData,
  });
}
