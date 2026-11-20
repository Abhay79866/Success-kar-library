'use client';

import React, { useEffect, useRef } from 'react';
import { Stage, Layer, Rect, Line, Text, Group, Arc, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { Category, SeatShape, SeatStatus } from '@/lib/types';

export interface CanvasSeatItem {
  id: string;
  floorId: string;
  seatCode: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: SeatShape;
  categoryId: string;
  status: SeatStatus;
}

interface FloorCanvasProps {
  widthPx: number;
  heightPx: number;
  items: CanvasSeatItem[];
  categories: Category[];
  selectedId: string | null;
  snapToGrid: boolean;
  gridSize?: number;
  onSelect: (id: string | null) => void;
  onChangeItem: (id: string, patch: Partial<CanvasSeatItem>) => void;
  onDropTool: (shape: SeatShape, x: number, y: number) => void;
}

function getContrastTextColor(hexColor: string): string {
  const clean = hexColor.replace('#', '');
  if (clean.length !== 6) return '#FDFBF7';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#2C2A29' : '#FDFBF7';
}

export default function FloorCanvas({
  widthPx,
  heightPx,
  items,
  categories,
  selectedId,
  snapToGrid,
  gridSize = 20,
  onSelect,
  onChangeItem,
  onDropTool,
}: FloorCanvasProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;

    if (!selectedId) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }

    const node = stage.findOne(`#node_${selectedId}`);
    if (node) {
      tr.nodes([node]);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selectedId, items]);

  const snap = (val: number) => {
    if (!snapToGrid) return Math.round(val);
    return Math.round(val / gridSize) * gridSize;
  };

  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const shape = e.dataTransfer.getData('application/x-library-shape') as SeatShape;
    if (!shape || !['desk', 'wall', 'door', 'pillar'].includes(shape)) return;

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const rawX = e.clientX - rect.left + container.scrollLeft;
    const rawY = e.clientY - rect.top + container.scrollTop;

    const x = clamp(snap(rawX - 28), 0, Math.max(0, widthPx - 40));
    const y = clamp(snap(rawY - 24), 0, Math.max(0, heightPx - 40));
    onDropTool(shape, x, y);
  };

  // Precompute grid lines
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
      ref={containerRef}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={handleDrop}
      className="relative overflow-auto bg-[#F4EFEA] border border-[#E4DDD5] rounded-xl"
      style={{ maxHeight: 'calc(100vh - 230px)' }}
    >
      <Stage
        ref={stageRef}
        width={widthPx}
        height={heightPx}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage() || e.target.name() === 'canvas-bg') {
            onSelect(null);
          }
        }}
        onTouchStart={(e) => {
          if (e.target === e.target.getStage() || e.target.name() === 'canvas-bg') {
            onSelect(null);
          }
        }}
      >
        {/* Background + Subtle Grid */}
        <Layer listening={true}>
          <Rect
            name="canvas-bg"
            x={0}
            y={0}
            width={widthPx}
            height={heightPx}
            fill="#F4EFEA"
          />
          {verticalLines.map((x) => (
            <Line
              key={`v_${x}`}
              points={[x, 0, x, heightPx]}
              stroke={x % (gridSize * 5) === 0 ? '#DDD4CA' : '#E9E2D9'}
              strokeWidth={1}
              listening={false}
            />
          ))}
          {horizontalLines.map((y) => (
            <Line
              key={`h_${y}`}
              points={[0, y, widthPx, y]}
              stroke={y % (gridSize * 5) === 0 ? '#DDD4CA' : '#E9E2D9'}
              strokeWidth={1}
              listening={false}
            />
          ))}
        </Layer>

        {/* Interactive Elements Layer */}
        <Layer>
          {items.map((item) => {
            const isSelected = item.id === selectedId;
            const category = item.categoryId ? categoryMap.get(item.categoryId) : undefined;
            const deskColor =
              item.status === 'maintenance'
                ? '#9C948D'
                : category?.colorHex || '#7D9B76';
            const textColor = getContrastTextColor(deskColor);

            return (
              <Group
                key={item.id}
                id={`node_${item.id}`}
                x={item.x}
                y={item.y}
                width={item.width}
                height={item.height}
                draggable
                onClick={() => onSelect(item.id)}
                onTap={() => onSelect(item.id)}
                onDragStart={() => onSelect(item.id)}
                onDragEnd={(e) => {
                  const node = e.target;
                  const nextX = clamp(snap(node.x()), 0, Math.max(0, widthPx - item.width));
                  const nextY = clamp(snap(node.y()), 0, Math.max(0, heightPx - item.height));
                  node.position({ x: nextX, y: nextY });
                  onChangeItem(item.id, { x: nextX, y: nextY });
                }}
                onTransformEnd={(e) => {
                  const node = e.target;
                  const scaleX = node.scaleX();
                  const scaleY = node.scaleY();
                  node.scaleX(1);
                  node.scaleY(1);

                  const nextWidth = clamp(Math.round(item.width * scaleX), 16, 1200);
                  const nextHeight = clamp(Math.round(item.height * scaleY), 12, 1200);
                  const nextX = clamp(snap(node.x()), 0, Math.max(0, widthPx - nextWidth));
                  const nextY = clamp(snap(node.y()), 0, Math.max(0, heightPx - nextHeight));
                  node.position({ x: nextX, y: nextY });

                  onChangeItem(item.id, {
                    x: nextX,
                    y: nextY,
                    width: nextWidth,
                    height: nextHeight,
                  });
                }}
              >
                {item.shape === 'desk' && (
                  <>
                    <Rect
                      width={item.width}
                      height={item.height}
                      fill={deskColor}
                      cornerRadius={6}
                      stroke={isSelected ? '#2C2A29' : '#2C2A2922'}
                      strokeWidth={isSelected ? 2 : 1}
                    />
                    {/* Subtle chair backrest indicator on bottom edge */}
                    <Rect
                      x={Math.max(6, item.width * 0.2)}
                      y={item.height - 4}
                      width={Math.max(12, item.width * 0.6)}
                      height={4}
                      fill="#2C2A29"
                      opacity={0.22}
                      cornerRadius={[0, 0, 4, 4]}
                      listening={false}
                    />
                    <Text
                      text={item.seatCode}
                      width={item.width}
                      height={item.height}
                      align="center"
                      verticalAlign="middle"
                      fontFamily="Inter, sans-serif"
                      fontSize={Math.min(13, Math.max(10, Math.floor(item.height * 0.28)))}
                      fontStyle="600"
                      fill={textColor}
                      padding={4}
                      listening={false}
                    />
                  </>
                )}

                {item.shape === 'wall' && (
                  <Rect
                    width={item.width}
                    height={item.height}
                    fill="#2C2A29"
                    cornerRadius={2}
                    stroke={isSelected ? '#D9775B' : '#2C2A29'}
                    strokeWidth={isSelected ? 2 : 0}
                  />
                )}

                {item.shape === 'door' && (
                  <>
                    <Rect
                      width={item.width}
                      height={item.height}
                      fill="#D9775B"
                      cornerRadius={2}
                      stroke={isSelected ? '#2C2A29' : '#B85D43'}
                      strokeWidth={isSelected ? 2 : 1}
                    />
                    <Arc
                      x={0}
                      y={item.height / 2}
                      innerRadius={0}
                      outerRadius={Math.min(item.width, 48)}
                      angle={90}
                      rotation={0}
                      stroke="#A8644C"
                      strokeWidth={1.5}
                      dash={[4, 3]}
                      listening={false}
                    />
                  </>
                )}

                {item.shape === 'pillar' && (
                  <>
                    <Rect
                      width={item.width}
                      height={item.height}
                      fill="#8C8279"
                      cornerRadius={4}
                      stroke={isSelected ? '#2C2A29' : '#6E6762'}
                      strokeWidth={isSelected ? 2 : 1}
                    />
                    <Line
                      points={[4, 4, item.width - 4, item.height - 4]}
                      stroke="#F4EFEA"
                      strokeWidth={1}
                      opacity={0.5}
                      listening={false}
                    />
                    <Line
                      points={[item.width - 4, 4, 4, item.height - 4]}
                      stroke="#F4EFEA"
                      strokeWidth={1}
                      opacity={0.5}
                      listening={false}
                    />
                  </>
                )}
              </Group>
            );
          })}

          <Transformer
            ref={transformerRef}
            rotateEnabled={false}
            borderStroke="#2C2A29"
            anchorStroke="#2C2A29"
            anchorFill="#FDFBF7"
            anchorSize={7}
            boundBoxFunc={(oldBox, newBox) => {
              if (newBox.width < 16 || newBox.height < 12) {
                return oldBox;
              }
              return newBox;
            }}
          />
        </Layer>
      </Stage>
    </div>
  );
}
