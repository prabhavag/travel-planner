import { NextResponse } from "next/server";
import { sessionStore, WORKFLOW_STATES } from "@/lib/services/session-store";
import { withSession } from "@/lib/api/route-handler";

export const POST = withSession(
  async (request, { sessionId, session, body }) => {
    const { selectedActivityIds } = body;

    // Validate that all selected IDs exist in suggested activities
    const validIds = new Set(session.suggestedActivities.map((a) => a.id));
    const invalidIds = selectedActivityIds.filter((id: string) => !validIds.has(id));

    if (invalidIds.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Invalid activity IDs: ${invalidIds.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Identify unselected activities from the current batch
    const newlyUnselected = session.suggestedActivities.filter(
      (a) => !selectedActivityIds.includes(a.id)
    );
    const selectedActivities = session.suggestedActivities.filter(
      (a) => selectedActivityIds.includes(a.id)
    );

    // Update session with selected and unselected activities
    // 1. Add current batch of unselected to history
    // 2. Remove any newly selected from history (in case they were previously unselected)
    const existingUnselectedIds = new Set(session.unselectedActivityIds || []);
    const existingUnselectedNames = new Set(session.unselectedActivityNames || []);

    newlyUnselected.forEach((a) => {
      existingUnselectedIds.add(a.id);
      existingUnselectedNames.add(a.name);
    });

    selectedActivities.forEach((a) => {
      existingUnselectedIds.delete(a.id);
      existingUnselectedNames.delete(a.name);
    });

    sessionStore.update(sessionId, {
      workflowState: WORKFLOW_STATES.SELECT_ACTIVITIES,
      selectedActivityIds: selectedActivityIds,
      unselectedActivityIds: Array.from(existingUnselectedIds),
      unselectedActivityNames: Array.from(existingUnselectedNames),
    });

    const selectedCount = selectedActivityIds.length;
    const message = `You've selected ${selectedCount} activit${selectedCount === 1 ? "y" : "ies"}. Ready to organize them into days!`;

    return NextResponse.json({
      success: true,
      sessionId,
      workflowState: WORKFLOW_STATES.SELECT_ACTIVITIES,
      message,
      selectedActivityIds,
      selectedCount,
    });
  },
  {
    allowedStates: [
      WORKFLOW_STATES.SUGGEST_ACTIVITIES,
      WORKFLOW_STATES.SELECT_ACTIVITIES,
      WORKFLOW_STATES.GROUP_DAYS,
      WORKFLOW_STATES.DAY_ITINERARY,
    ],
    validateBody: (body) =>
      !body.selectedActivityIds || !Array.isArray(body.selectedActivityIds)
        ? "Missing or invalid selectedActivityIds"
        : null,
  }
);
