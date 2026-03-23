const fs = require('fs');
const content = fs.readFileSync('components/DayGroupingView.tsx', 'utf-8');
const lines = content.split('\n');

// 1. Find and slice block
const getDayStartIdx = lines.findIndex(l => l.includes('const getDayStartContext = useCallback('));
const regroupIdx = lines.findIndex(l => l.includes('const regroupSchedulableActivitiesForDay = useCallback('));
let regroupEndIdx = regroupIdx;
while (!lines[regroupEndIdx].match(/^\s{2}\);$/)) { regroupEndIdx++; }
const blockToMove = lines.slice(getDayStartIdx, regroupEndIdx + 1);
lines.splice(getDayStartIdx, regroupEndIdx - getDayStartIdx + 1);

// 2. Remove old state
const unschedStateIdx = lines.findIndex(l => l.includes('const [unscheduledByDay, setUnscheduledByDay]'));
if (unschedStateIdx !== -1) {
    lines.splice(unschedStateIdx, 1);
    const unschedRefIdx = lines.findIndex(l => l.includes('const unscheduledSyncSignatureByDayRef'));
    if (unschedRefIdx !== -1) {
        lines.splice(unschedRefIdx, 1);
    }
}

// 3. Insert before unscheduledActivities and replace unscheduledActivities
const insertIdx = lines.findIndex(l => l.includes('const unscheduledActivities = useMemo('));
let oldEndIdx = insertIdx;
while (!lines[oldEndIdx].match(/^\s{2}\}, \[unscheduledByDay\]\);$/)) { oldEndIdx++; }

const newUnschedBlock = [
    ...blockToMove,
    '',
    '  const regroupedActivitiesByDay = useMemo(() => {',
    '    const map: Record<number, ReturnType<typeof regroupSchedulableActivitiesForDay>> = {};',
    '    groupedDays.forEach((day, index) => {',
    '      const startStayLabel = getStartStayLabel(groupedDays, index);',
    '      const endStayLabel = day.nightStay?.label;',
    '      const startStayCoordinates = getStartStayCoordinates(groupedDays, day, index);',
    '      const endStayCoordinates = day.nightStay?.coordinates;',
    '      map[day.dayNumber] = regroupSchedulableActivitiesForDay({',
    '        day,',
    '        dayIndex: index,',
    '        startStayLabel,',
    '        endStayLabel,',
    '        startStayCoordinates,',
    '        endStayCoordinates,',
    '      });',
    '    });',
    '    return map;',
    '  }, [groupedDays, regroupSchedulableActivitiesForDay, getStartStayLabel, getStartStayCoordinates]);',
    '',
    '  const unscheduledActivities = useMemo(() => {',
    '    const deduped = new Map<string, SuggestedActivity>();',
    '    Object.values(regroupedActivitiesByDay).forEach((regrouped) => {',
    '      regrouped.prunedActivities.forEach((activity) => {',
    '        if (!deduped.has(activity.id)) {',
    '          deduped.set(activity.id, activity);',
    '        }',
    '      });',
    '    });',
    '    return [...deduped.values()];',
    '  }, [regroupedActivitiesByDay]);'
];
lines.splice(insertIdx, oldEndIdx - insertIdx + 1, ...newUnschedBlock);

// 4. Update the JSX `<DayTimelineRows ... />`
const jsxIdx = lines.findIndex(l => l.includes('<DayTimelineRows'));
if (jsxIdx !== -1) {
    let jsxEnd = jsxIdx;
    while (!lines[jsxEnd].includes('/>')) { jsxEnd++; }
    
    const newJsx = [
        '                        <DayTimelineRows',
        '                          day={day}',
        '                          rawDay={rawDayByNumber.get(day.dayNumber)}',
        '                          dayIndex={index}',
        '                          startStayLabel={startStayLabel}',
        '                          endStayLabel={endStayLabel}',
        '                          startStayCoordinates={startStayCoordinates}',
        '                          endStayCoordinates={endStayCoordinates}',
        '                          regroupedActivities={regroupedActivitiesByDay[day.dayNumber]}',
        '                          startContext={getDayStartContext(index, startStayLabel)}',
        '                          isFinalDepartureDay={isDepartureDay(day, index)}',
        '                          commuteByLeg={commuteByLeg}',
        '                          isRailFriendlyDestination={isRailFriendlyDestination}',
        '                          sunsetMinutes={DEFAULT_SUNSET_MINUTES}',
        '                          tripInfo={tripInfo}',
        '                          debugMode={debugMode}',
        '                          userPreferences={userPreferences}',
        '                          displayGroupedDays={displayGroupedDays}',
        '                          collapsedActivityCards={collapsedActivityCards}',
        '                          movingActivity={movingActivity}',
        '                          dragInsertion={dragInsertion}',
        '                          draggedActivity={draggedActivity}',
        '                          sourceDayByActivityId={sourceDayByActivityId}',
        '                          onDayDragOver={handleDayDragOver}',
        '                          onActivityDrop={handleActivityDrop}',
        '                          onActivityDragStart={handleActivityDragStart}',
        '                          onActivityDragOver={handleActivityDragOver}',
        '                          onActivityDragEnd={handleActivityDragEnd}',
        '                          onToggleCollapse={toggleActivityCollapse}',
        '                          onMoveStart={handleMoveStart}',
        '                          onMoveConfirm={handleMoveConfirm}',
        '                          onMoveCancel={handleMoveCancel}',
        '                        />'
    ];
    lines.splice(jsxIdx, jsxEnd - jsxIdx + 1, ...newJsx);
}

fs.writeFileSync('components/DayGroupingView.tsx', lines.join('\n'));
