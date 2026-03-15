import { listNodes, getNodeByPath, getChildren } from "@/lib/db";
import { SpaceSidebar } from "@/components/layout/space-sidebar";
import { NodeFeed } from "@/components/nodes/node-feed";
import { CreateNodeForm } from "@/components/nodes/create-node-form";
import Link from "next/link";
import { IconHash, IconChevronRight } from "@tabler/icons-react";

export const dynamic = "force-dynamic";

export default async function SpacePage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const spacePath = path.join("/");
  const spaces = listNodes({ depth: 0 });
  const space = getNodeByPath(spacePath);

  if (!space) {
    return (
      <div className="flex h-screen bg-stone-50">
        <SpaceSidebar spaces={spaces} dbError={false} />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-[14px] font-medium text-stone-700 mb-1">Space not found</p>
            <p className="text-[12px] text-stone-400 font-data">{spacePath}</p>
          </div>
        </main>
      </div>
    );
  }

  const children = getChildren(space.id);
  const subspaces = children.filter(n => n.type === "space");
  const content = children.filter(n => n.type !== "space");
  const pathParts = spacePath.split("/");

  return (
    <div className="flex h-screen bg-stone-50 overflow-hidden">
      <SpaceSidebar spaces={spaces} dbError={false} />

      <main className="flex-1 flex flex-col min-w-0">
        {/* Breadcrumb header */}
        <header className="h-14 border-b border-stone-200 flex items-center px-6 shrink-0 bg-white">
          <div className="flex items-center gap-1 text-[13px]">
            <Link href="/" className="text-stone-400 hover:text-stone-600 transition-colors">Overview</Link>
            {pathParts.map((part, i) => (
              <span key={i} className="flex items-center gap-1">
                <IconChevronRight size={12} className="text-stone-300" />
                {i === pathParts.length - 1 ? (
                  <span className="text-stone-900 font-medium flex items-center gap-1">
                    <IconHash size={12} className="text-stone-400" />{part}
                  </span>
                ) : (
                  <Link href={`/spaces/${pathParts.slice(0, i + 1).join("/")}`} className="text-stone-400 hover:text-stone-600 transition-colors">
                    {part}
                  </Link>
                )}
              </span>
            ))}
          </div>
        </header>

        {/* Space title */}
        <div className="border-b border-stone-200 px-6 py-3 bg-white">
          <h1 className="text-[16px] font-semibold text-stone-900">{space.title}</h1>
          <p className="text-[12px] text-stone-400 mt-0.5">{space.childCount} items</p>
        </div>

        <div className="flex-1 overflow-y-auto bg-stone-50">
          <div className="max-w-2xl mx-auto py-6 px-6">
            {subspaces.length > 0 && (
              <div className="mb-6">
                <h2 className="text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-2">Sub-spaces</h2>
                <div className="grid grid-cols-2 gap-2">
                  {subspaces.map(sub => (
                    <Link key={sub.id} href={`/spaces/${sub.path}`}
                      className="bg-white border border-stone-200 rounded-lg p-3 card-hover">
                      <div className="text-[13px] text-stone-700 flex items-center gap-1.5">
                        <IconHash size={12} className="text-stone-300" />
                        {(sub.title ?? "").toLowerCase()}
                      </div>
                      <div className="text-[11px] text-stone-400 mt-0.5">{sub.childCount} items</div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <CreateNodeForm parentId={space.id} parentPath={space.path ?? spacePath} />
            </div>

            {content.length > 0 ? (
              <>
                <h2 className="text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-2">Content</h2>
                <NodeFeed nodes={content} />
              </>
            ) : subspaces.length === 0 && (
              <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
                <p className="text-[13px] text-stone-400">This space is empty</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
