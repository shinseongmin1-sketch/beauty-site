// 예약 관리 화면의 시간대별 캘린더에서, 겹치는 예약끼리 옆으로 나란히
// 배치하기 위한 순수 계산 함수. (실제 구글 캘린더 day view와 같은 방식)

export interface TimeBlockInput {
  id: string;
  start: Date;
  end: Date;
}

export interface TimeBlockLayout {
  id: string;
  topMinutes: number; // 캘린더 시작 시각(gridStartHour) 기준 상단 오프셋(분)
  durationMinutes: number;
  lane: number;
  laneCount: number;
}

export function layoutTimeBlocks(
  blocks: TimeBlockInput[],
  dayStart: Date,
  gridStartHour: number
): TimeBlockLayout[] {
  const sorted = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  const gridStart = new Date(dayStart);
  gridStart.setHours(gridStartHour, 0, 0, 0);
  const gridStartMs = gridStart.getTime();

  // 1) 시간이 겹치는 예약끼리 클러스터로 묶는다.
  const clusters: TimeBlockInput[][] = [];
  let current: TimeBlockInput[] = [];
  let currentMaxEnd = -Infinity;

  for (const block of sorted) {
    if (current.length === 0 || block.start.getTime() < currentMaxEnd) {
      current.push(block);
      currentMaxEnd = Math.max(currentMaxEnd, block.end.getTime());
    } else {
      clusters.push(current);
      current = [block];
      currentMaxEnd = block.end.getTime();
    }
  }
  if (current.length > 0) clusters.push(current);

  const result: TimeBlockLayout[] = [];

  for (const cluster of clusters) {
    // 2) 클러스터 안에서 레인을 그리디하게 배정 (기존 레인이 비면 재사용).
    const laneEndTimes: number[] = [];
    const laneOf = new Map<string, number>();

    for (const block of cluster) {
      let lane = laneEndTimes.findIndex((endTime) => endTime <= block.start.getTime());
      if (lane === -1) {
        lane = laneEndTimes.length;
        laneEndTimes.push(block.end.getTime());
      } else {
        laneEndTimes[lane] = block.end.getTime();
      }
      laneOf.set(block.id, lane);
    }

    const laneCount = laneEndTimes.length;

    for (const block of cluster) {
      result.push({
        id: block.id,
        topMinutes: (block.start.getTime() - gridStartMs) / 60_000,
        durationMinutes: (block.end.getTime() - block.start.getTime()) / 60_000,
        lane: laneOf.get(block.id)!,
        laneCount,
      });
    }
  }

  return result;
}
