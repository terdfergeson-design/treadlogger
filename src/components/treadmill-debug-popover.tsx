"use client";

import { Download, Settings, Trash2 } from "lucide-react";

import { useFtmsDebugLogEnabled } from "@/hooks/use-ftms-debug-log-enabled";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { clearFtmsDebugLog, downloadFtmsDebugLog } from "@/lib/ble/ftms-debug-log";

/**
 * Gear button on the treadmill card that opens the "Debug logging" popover.
 *
 * Off by default: this exists for troubleshooting a treadmill this app
 * hasn't been tested against, not for everyday use, so it stays tucked
 * behind an icon rather than a switch on the card itself. Turning it on
 * captures every step of the Bluetooth connection — device selection,
 * service and characteristic discovery, control-point commands and
 * responses, and each Treadmill Data notification — entirely in this
 * browser tab, so a user can download it and attach it wherever they're
 * reporting the issue.
 */
export function TreadmillDebugPopover({ deviceName }: { deviceName?: string }) {
  const [enabled, setEnabled] = useFtmsDebugLogEnabled();

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Treadmill debug settings"
        className={buttonVariants({ variant: "ghost", size: "icon" })}
      >
        <Settings className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end">
        <PopoverHeader>
          <PopoverTitle>Debug logging</PopoverTitle>
          <PopoverDescription>
            Records every step of the treadmill&apos;s Bluetooth connection — useful if this app
            hasn&apos;t been tried with your treadmill before and something isn&apos;t working. Stays
            in this browser tab; nothing is sent anywhere.
          </PopoverDescription>
        </PopoverHeader>

        <div className="flex items-center justify-between gap-3 pt-1">
          <Label htmlFor="ftms-debug-log-enabled" className="text-sm font-normal">
            Enable debug log
          </Label>
          <Switch
            id="ftms-debug-log-enabled"
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(checked === true)}
          />
        </div>

        {enabled ? (
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => downloadFtmsDebugLog(deviceName)}
            >
              <Download className="size-3.5" />
              Download log
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Clear debug log"
              onClick={() => clearFtmsDebugLog()}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
