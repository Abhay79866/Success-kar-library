'use client';

import React from 'react';
import { Stage, Layer, Rect, Line, Text, Group, Arc } from 'react-konva';
import type { Category, Seat } from '@/lib/types';

export interface BookedSeatDisplayInfo {
  fillColor: string;
  studentName: string;
  shiftLabel: string;
}

interface BookingFloorMapProps {
  widthPx: number;
  heightPx: number;
  seats: Seat[];
  categories: Category[];
  bookedSeatInfoMap: Map<string, BookedSeatDisplayInfo>;
  selectedSeatId: string | null;
  onSelectSeat: (seat: Seat) => void;
}

export default function BookingFloorMap({
  widthPx,
  heightPx,
  seats,
  categories,
  bookedSeatInfoMap,
  selectedSeatId,
  onSelectSeat,
}: BookingFloorMapProps) {
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const gridSize = 20;

  const verticalLines: number[] = [];
  for (let x = gridSize; x < widthPx; x += gridSize) {
    verticalLines.push(x);
  }
  const horizontalLines: number[] = [];
  for (let y = gridSize; y < heightPx; y += gridSize) {
    horizontalLines.push(y);
  }

  return (
    <div
      className="relative overflow-auto bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl"
      style={{ maxHeight: 'calc(100vh - 280px)' }}
    >
      <Stage width={widthPx} height={heightPx}>
        <Layer listening={false}>
          <Rect x={0} y={0} width={widthPx} height={heightPx} fill="#F4EFEA" />
          {verticalLines.map((x) => (
            <Line
              key={`v_${x}`}
              points={[x, 0, x, heightPx]}
              stroke={x % 100 === 0 ? '#DDD4CA' : '#ECE5DC'}
              strokeWidth={1}
            />
          ))}
          {horizontalLines.map((y) => (
            <Line
              key={`h_${y}`}
              points={[0, y, widthPx, y]}
              stroke={y % 100 === 0 ? '#DDD4CA' : '#ECE5DC'}
              strokeWidth={1}
            />
          ))}
        </Layer>

        <Layer>
          {seats.map((seat) => {
            const w =
              seat.width ??
              (seat.shape === 'desk'
                ? 64
                : seat.shape === 'wall'
                  ? 160
                  : seat.shape === 'door'
                    ? 60
                    : 40);
            const h =
              seat.height ??
              (seat.shape === 'desk'
                ? 48
                : seat.shape === 'wall'
                  ? 16
                  : seat.shape === 'door'
                    ? 16
                    : 40);

            if (seat.shape === 'wall') {
              return (
                <Rect
                  key={seat.id}
                  x={seat.x}
                  y={seat.y}
                  width={w}
                  height={h}
                  fill="#2C2A29"
                  cornerRadius={2}
                  listening={false}
                />
              );
            }

            if (seat.shape === 'door') {
              return (
                <Group key={seat.id} x={seat.x} y={seat.y} listening={false}>
                  <Rect width={w} height={h} fill="#D9775B" cornerRadius={2} />
                  <Arc
                    x={0}
                    y={h / 2}
                    innerRadius={0}
                    outerRadius={Math.min(w, 48)}
                    angle={90}
                    rotation={0}
                    stroke="#A8644C"
                    strokeWidth={1.5}
                    dash={[4, 3]}
                  />
                </Group>
              );
            }

            if (seat.shape === 'pillar') {
              return (
                <Group key={seat.id} x={seat.x} y={seat.y} listening={false}>
                  <Rect width={w} height={h} fill="#8C8279" cornerRadius={4} />
                  <Line
                    points={[4, 4, w - 4, h - 4]}
                    stroke="#F4EFEA"
                    strokeWidth={1}
                    opacity={0.5}
                  />
                  <Line
                    points={[w - 4, 4, 4, h - 4]}
                    stroke="#F4EFEA"
                    strokeWidth={1}
                    opacity={0.5}
                  />
                </Group>
              );
            }

            // Desk status colors: Sage Green (Available), Red/Pink/Brick (Booked by Gender), Muted Gray (Maintenance)
            const bookedInfo = bookedSeatInfoMap.get(seat.id) || null;
            const isBooked = bookedInfo !== null;
            const isMaintenance = seat.status === 'maintenance';
            const isSelected = !isBooked && !isMaintenance && selectedSeatId === seat.id;
            const category = seat.categoryId ? categoryMap.get(seat.categoryId) : undefined;

            const fillColor = isMaintenance
              ? '#9C948D'
              : bookedInfo
                ? bookedInfo.fillColor
                : '#7D9B76';

            const showStackedBookedLabels = isBooked && h >= 42 && w >= 52;

            return (
              <Group
                key={seat.id}
                x={seat.x}
                y={seat.y}
                onClick={() => onSelectSeat(seat)}
                onTap={() => onSelectSeat(seat)}
                onMouseEnter={(e) => {
                  const stage = e.target.getStage();
                  if (stage) {
                    stage.container().style.cursor =
                      isBooked || isMaintenance ? 'not-allowed' : 'pointer';
                  }
                }}
                onMouseLeave={(e) => {
                  const stage = e.target.getStage();
                  if (stage) stage.container().style.cursor = 'default';
                }}
              >
                <Rect
                  width={w}
                  height={h}
                  fill={fillColor}
                  cornerRadius={6}
                  stroke={isSelected ? '#2C2A29' : '#2C2A2926'}
                  strokeWidth={isSelected ? 3 : 1}
                />
                {/* Category subtle top indicator strip */}
                {category && !isBooked && !isMaintenance && (
                  <Rect
                    x={4}
                    y={3}
                    width={Math.max(8, w - 8)}
                    height={3}
                    fill={category.colorHex}
                    cornerRadius={2}
                    opacity={0.95}
                    listening={false}
                  />
                )}

                {showStackedBookedLabels && bookedInfo ? (
                  <>
                    <Text
                      text={seat.seatCode}
                      x={3}
                      y={4}
                      width={w - 6}
                      height={13}
                      align="center"
                      verticalAlign="middle"
                      fontFamily="Inter, sans-serif"
                      fontSize={11}
                      fontStyle="700"
                      fill="#FDFBF7"
                      ellipsis
                      wrap="none"
                      listening={false}
                    />
                    <Text
                      text={bookedInfo.studentName}
                      x={3}
                      y={18}
                      width={w - 6}
                      height={12}
                      align="center"
                      verticalAlign="middle"
                      fontFamily="Inter, sans-serif"
                      fontSize={9.5}
                      fontStyle="600"
                      fill="#FDFBF7"
                      ellipsis
                      wrap="none"
                      listening={false}
                    />
                    <Text
                      text={bookedInfo.shiftLabel}
                      x={3}
                      y={Math.max(31, h - 15)}
                      width={w - 6}
                      height={11}
                      align="center"
                      verticalAlign="middle"
                      fontFamily="Inter, sans-serif"
                      fontSize={8.5}
                      fontStyle="500"
                      fill="#FDFBF7"
                      opacity={0.9}
                      ellipsis
                      wrap="none"
                      listening={false}
                    />
                  </>
                ) : (
                  <Text
                    text={
                      bookedInfo
                        ? `${seat.seatCode}\n${bookedInfo.studentName}`
                        : seat.seatCode
                    }
                    width={w}
                    height={h}
                    align="center"
                    verticalAlign="middle"
                    fontFamily="Inter, sans-serif"
                    fontSize={
                      bookedInfo
                        ? Math.min(10, Math.max(8, Math.floor(h * 0.22)))
                        : Math.min(13, Math.max(10, Math.floor(h * 0.28)))
                    }
                    fontStyle="600"
                    fill="#FDFBF7"
                    padding={3}
                    ellipsis
                    listening={false}
                  />
                )}
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
