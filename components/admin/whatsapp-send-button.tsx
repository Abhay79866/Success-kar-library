'use client';

import React from 'react';
import { Check, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { buildWhatsAppReminderUrl } from '@/lib/reminders';
import type { Student } from '@/lib/types';
import { cn } from '@/lib/utils';

interface WhatsAppSendButtonProps {
  student: Student;
  todayStr: string;
  remindedToday: boolean;
  onReminded: (studentId: string) => void;
  className?: string;
}

export function WhatsAppSendButton({
  student,
  todayStr,
  remindedToday,
  onReminded,
  className,
}: WhatsAppSendButtonProps) {
  const handleSend = () => {
    const url = buildWhatsAppReminderUrl(student, todayStr);
    if (!url) {
      toast.error(`Missing valid phone number for ${student.name}`);
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
    onReminded(student.id);
  };

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <Button
        type="button"
        size="sm"
        onClick={handleSend}
        className="h-8 px-3 bg-[#16A34A] hover:bg-[#15803D] text-white font-medium whitespace-nowrap cursor-pointer"
        title={`Send WhatsApp fee reminder to ${student.name}`}
      >
        <MessageCircle className="size-3.5 mr-1.5" />
        Send
      </Button>
      {remindedToday && (
        <span className="inline-flex items-center gap-1 rounded-md bg-[#7D9B76]/15 border border-[#7D9B76]/30 px-2 py-0.5 text-[11px] font-medium text-[#4A6644] whitespace-nowrap">
          <Check className="size-3" />
          Reminded today
        </span>
      )}
    </div>
  );
}
