"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type NodeData } from "@/lib/db";
import {
  IconDashboard,
  IconFileReport,
  IconLayoutKanban,
  IconSearch,
  IconRobot,
  IconPlayerPlay,
  IconClock,
  IconTimeline,
  IconHash,
  IconRocket,
} from "@tabler/icons-react";

function NavLink({ href, icon: Icon, label, active }: { href: string; icon: React.ComponentType<{ size?: number; stroke?: number; className?: string }>; label: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] transition-colors
        ${active
          ? "bg-stone-100 text-stone-900 font-medium"
          : "text-stone-500 hover:text-stone-700 hover:bg-stone-50"
        }`}
    >
      <Icon size={15} stroke={1.8} className={active ? "text-stone-900" : "text-stone-400"} />
      {label}
    </Link>
  );
}

export function SpaceSidebar({ spaces, dbError }: { spaces: NodeData[]; dbError: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="w-56 border-r border-stone-200 bg-white flex flex-col shrink-0">
      {/* Logo */}
      <div className="h-14 border-b border-stone-200 flex items-center px-4 gap-2.5">
        <div className="w-6 h-6 rounded-md bg-stone-900 flex items-center justify-center">
          <IconRocket size={13} stroke={2} className="text-white" />
        </div>
        <span className="text-[14px] font-semibold text-stone-900 tracking-tight">Space Station</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
        <div className="mb-3 space-y-0.5">
          <NavLink href="/" icon={IconDashboard} label="Overview" active={pathname === "/"} />
          <NavLink href="/briefing" icon={IconFileReport} label="Briefing" active={pathname === "/briefing"} />
          <NavLink href="/board" icon={IconLayoutKanban} label="Board" active={pathname === "/board"} />
          <NavLink href="/timeline" icon={IconTimeline} label="Timeline" active={pathname === "/timeline"} />
          <NavLink href="/search" icon={IconSearch} label="Search" active={pathname === "/search"} />
        </div>

        <div className="mb-3 space-y-0.5">
          <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wider px-2.5 mb-1.5">Systems</p>
          <NavLink href="/agents" icon={IconRobot} label="Agents" active={pathname === "/agents"} />
          <NavLink href="/cron" icon={IconClock} label="Schedules" active={pathname === "/cron"} />
          <NavLink href="/runs" icon={IconPlayerPlay} label="Runs" active={pathname === "/runs"} />
        </div>

        {/* Spaces */}
        <div>
          <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wider px-2.5 mb-1.5">Spaces</p>

          {dbError ? (
            <p className="px-2.5 py-2 text-[12px] text-red-500">No database</p>
          ) : spaces.length === 0 ? (
            <p className="px-2.5 py-2 text-[12px] text-stone-400">No spaces yet</p>
          ) : (
            <div className="space-y-0.5">
              {spaces.map((space) => {
                const isActive = pathname === `/spaces/${space.path}`;
                return (
                  <Link
                    key={space.id}
                    href={`/spaces/${space.path}`}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-colors group
                      ${isActive
                        ? "bg-stone-100 text-stone-900 font-medium"
                        : "text-stone-500 hover:text-stone-700 hover:bg-stone-50"
                      }`}
                  >
                    <IconHash size={13} stroke={1.8} className={isActive ? "text-stone-700" : "text-stone-300"} />
                    <span className="truncate">{(space.title ?? space.slug ?? "").toLowerCase()}</span>
                    {space.childCount > 0 && (
                      <span className="ml-auto text-[10px] font-mono text-stone-300 group-hover:text-stone-400 transition-colors">
                        {space.childCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-stone-200 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 status-pulse" />
          <span className="text-[11px] text-stone-400">Online</span>
        </div>
      </div>
    </aside>
  );
}
