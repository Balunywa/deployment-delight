/*
 * The traffic drawing as a draw.io file: frames, parts with draw.io's own Azure icons (img/lib/azure2, the same
 * official icon set), the fixed connections, and every traffic flow as an animated connector in its legend
 * colour. Opens in draw.io / diagrams.net and the draw.io VS Code extension.
 */
import { ICONS, type TEdge, type TNode } from "./layout";

export type DrawioFlow = {
  id: string;
  source: string;
  target: string;
  color: string;
  dashed: boolean;
  label?: string | undefined;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const STATIC: Record<TEdge["kind"], string> = {
  peering: "strokeColor=#9db4d6;strokeWidth=1.5;startArrow=block;endArrow=block;",
  global: "strokeColor=#9db4d6;strokeWidth=2;startArrow=block;endArrow=block;",
  er: "strokeColor=#55a6ff;strokeWidth=2.5;endArrow=none;",
  bgp: "strokeColor=#55a6ff;strokeWidth=1.2;endArrow=none;",
  ipsec: "strokeColor=#8661c5;strokeWidth=1.8;dashed=1;dashPattern=6 5;endArrow=none;",
  wan: "strokeColor=#94a3b8;strokeWidth=1.2;startArrow=block;endArrow=block;",
  link: "strokeColor=#9db4d6;strokeWidth=1.2;endArrow=none;",
  p2s: "strokeColor=#94a3b8;strokeWidth=1.2;dashed=1;endArrow=none;",
};

const ZONE = {
  azure: { fill: "#1a2230", stroke: "#3b4a63" },
  band: { fill: "#1d2636", stroke: "#4a5a76" },
  onprem: { fill: "#0f141c", stroke: "#3b82f6" },
  vnet: { fill: "#141b26", stroke: "#4a5a76" },
  zone: { fill: "#141b26", stroke: "#4a5a76" },
  subscription: { fill: "#141b26", stroke: "#4a5a76" },
} as const;
const NODE = { fill: "#1f2836", stroke: "#3d4b62", font: "#e8eef7", sub: "#93a3b8" };

export function toDrawio(
  name: string,
  nodes: TNode[],
  edges: TEdge[],
  flows: DrawioFlow[],
): string {
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const geo = (n: { x: number; y: number; w: number; h: number }) =>
    `<mxGeometry x="${Math.round(n.x)}" y="${Math.round(n.y)}" width="${Math.round(n.w)}" height="${Math.round(n.h)}" as="geometry"/>`;
  for (const n of nodes) {
    if (n.kind === "cloud") {
      const label = `<b>${esc(n.title)}</b>${n.detail ? `<br><font color="${NODE.sub}" style="font-size:12px">${esc(n.detail)}</font>` : ""}`;
      cells.push(
        `<mxCell id="${esc(n.id)}" value="${esc(label)}" style="rounded=1;arcSize=10;whiteSpace=wrap;html=1;fontSize=14;fontColor=${NODE.font};fillColor=${NODE.fill};strokeColor=${NODE.stroke};" vertex="1" parent="1">${geo(n)}</mxCell>`,
      );
      continue;
    }
    if (n.kind === "frame") {
      const z = ZONE[n.zoneKind ?? (n.dashed ? "vnet" : "zone")];
      const label = `${n.chip ? `<span style="background:${n.chip.fill};color:#ffffff;padding:2px 8px;border:1px solid ${z.stroke}">${esc(n.chip.text)}</span><br>` : ""}<b>${esc(n.title)}</b>${n.detail ? `<br><font color="${NODE.sub}" style="font-size:12px">${esc(n.detail)}</font>` : ""}`;
      cells.push(
        `<mxCell id="${esc(n.id)}" value="${esc(label)}" style="rounded=1;arcSize=6;whiteSpace=wrap;html=1;verticalAlign=top;align=left;spacingLeft=12;spacingTop=6;fontSize=14;fontColor=${NODE.font};fillColor=${z.fill};strokeColor=${z.stroke};${n.dashed || n.absent || n.zoneKind === "vnet" ? "dashed=1;" : ""}${n.down ? "opacity=45;" : ""}" vertex="1" parent="1">${geo(n)}</mxCell>`,
      );
      continue;
    }
    const label = `<b>${esc(n.title)}</b>${n.detail ? `<br><font color="${NODE.sub}" style="font-size:12px">${esc(n.detail)}</font>` : ""}${n.tag ? `<br><font color="#4da3ff" style="font-size:11px">${esc(n.tag)}</font>` : ""}`;
    cells.push(
      `<mxCell id="${esc(n.id)}" value="${esc(label)}" style="rounded=1;arcSize=8;whiteSpace=wrap;html=1;align=left;verticalAlign=middle;spacingLeft=52;fontSize=14;fontColor=${NODE.font};fillColor=${NODE.fill};strokeColor=${n.failed ? "#ef4444" : NODE.stroke};${n.absent ? "dashed=1;opacity=55;" : ""}${n.down ? "opacity=45;" : ""}" vertex="1" parent="1">${geo(n)}</mxCell>`,
    );
    if (n.icon)
      cells.push(
        `<mxCell id="${esc(n.id)}__icon" value="" style="image;aspect=fixed;html=1;points=[];image=img/lib/azure2/${ICONS[n.icon]};" vertex="1" parent="1"><mxGeometry x="${Math.round(n.x + 10)}" y="${Math.round(n.y + (n.h - 36) / 2)}" width="36" height="36" as="geometry"/></mxCell>`,
      );
  }
  const has = new Set(nodes.map((n) => n.id));
  const edge = (id: string, source: string, target: string, style: string, label?: string) =>
    has.has(source) && has.has(target)
      ? `<mxCell id="${esc(id)}" value="${esc(label ?? "")}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;fontSize=11;fontColor=${NODE.font};labelBackgroundColor=#0f141c;${style}" edge="1" parent="1" source="${esc(source)}" target="${esc(target)}"><mxGeometry relative="1" as="geometry"/></mxCell>`
      : "";
  for (const e of edges)
    cells.push(
      edge(
        `e:${e.id}`,
        e.source,
        e.target,
        STATIC[e.kind] + (e.down ? "opacity=35;" : ""),
        e.label,
      ),
    );
  for (const f of flows)
    cells.push(
      edge(
        `f:${f.id}`,
        f.source,
        f.target,
        `strokeColor=${f.color};strokeWidth=2.5;${f.dashed ? "dashed=1;dashPattern=8 5;" : ""}flowAnimation=1;endArrow=block;endFill=1;`,
        f.label,
      ),
    );
  return `<mxfile host="Cloud Delivery" type="device"><diagram name="${esc(name)}" id="traffic"><mxGraphModel grid="0" page="0" pageScale="1" math="0" shadow="0"><root>${cells.join("")}</root></mxGraphModel></diagram></mxfile>`;
}
