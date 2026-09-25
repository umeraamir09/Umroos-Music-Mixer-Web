"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Download, Eye, EyeOff, ImagePlus, LockKeyhole, Pencil, Plus, Redo2, RotateCcw, Sticker, Trash2, Type, Undo2, UnlockKeyhole, X } from "lucide-react";
import Konva from "konva";
import { Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import { publicUserId, readLocalMix, storeLocalMix } from "@/components/mix-storage";
import { ThemeToggle } from "@/components/theme-toggle";
import { ART_SIZE, newArtProject, readArtProject, storeArtProject, type ArtEffect, type ArtLayer, type ArtProject } from "@/lib/playlist-art";
import type { MixRecord } from "@/lib/types";
import styles from "./playlist-art-editor.module.css";

const STICKERS = ["✦", "♥", "★", "☻", "✿", "♫", "⚡", "☁", "✳", "◉", "✴", "☀"];
const EFFECTS: { value: ArtEffect; label: string }[] = [
  { value: "none", label: "Original" }, { value: "mono", label: "Mono" },
  { value: "sepia", label: "Sepia" }, { value: "bright", label: "Bright" },
  { value: "contrast", label: "Contrast" },
];

function useLoadedImage(src?: string) {
  const [loaded, setLoaded] = useState<{ src: string; image: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!src) return;
    const next = new window.Image();
    next.onload = () => setLoaded({ src, image: next });
    next.src = src;
    return () => { next.onload = null; };
  }, [src]);
  return loaded && loaded.src === src ? loaded.image : null;
}

function EffectImage({ src, effect = "none", nodeRef, ...props }: { src: string; effect?: ArtEffect; nodeRef?: (node: Konva.Node | null) => void } & Omit<React.ComponentProps<typeof KonvaImage>, "image" | "ref">) {
  const image = useLoadedImage(src);
  const ref = useRef<Konva.Image>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !image) return;
    node.clearCache();
    const filters = effect === "mono" ? [Konva.Filters.Grayscale]
      : effect === "sepia" ? [Konva.Filters.Sepia]
      : effect === "bright" ? [Konva.Filters.Brightness]
      : effect === "contrast" ? [Konva.Filters.Contrast] : [];
    if (filters.length) {
      node.cache({ pixelRatio: 1 });
      node.filters(filters);
      if (effect === "bright") node.brightness(1.22);
      if (effect === "contrast") node.contrast(28);
    } else node.filters([]);
    node.getLayer()?.batchDraw();
  }, [image, effect, props.width, props.height]);
  return <KonvaImage {...props} image={image || undefined} ref={(node) => { ref.current = node; nodeRef?.(node); }} />;
}

function objectName(layer: ArtLayer) {
  if (layer.kind === "text") return layer.text?.trim().slice(0, 22) || "Text";
  if (layer.kind === "sticker") return `${layer.text} Sticker`;
  return layer.name;
}

function coverCrop(image: HTMLImageElement | null) {
  if (!image) return undefined;
  const side = Math.min(image.width, image.height);
  return { x: (image.width - side) / 2, y: (image.height - side) / 2, width: side, height: side };
}

function BackgroundImage({ src, effect }: { src: string; effect: ArtEffect }) {
  const image = useLoadedImage(src);
  return <EffectImage src={src} effect={effect} x={0} y={0} width={ART_SIZE} height={ART_SIZE} crop={coverCrop(image)} listening={false} />;
}

async function prepareImage(file: File): Promise<{ src: string; width: number; height: number }> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose an image smaller than 20 MB.");
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not open that image."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const next = new window.Image();
    next.onload = () => resolve(next);
    next.onerror = () => reject(new Error("Could not read that image."));
    next.src = src;
  });
  const ratio = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { src: canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", .86), width: canvas.width, height: canvas.height };
}

export default function PlaylistArtEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [mix, setMix] = useState<MixRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [doc, setDoc] = useState<ArtProject>(() => newArtProject());
  const [past, setPast] = useState<ArtProject[]>([]);
  const [future, setFuture] = useState<ArtProject[]>([]);
  const [selectedId, setSelectedId] = useState<string>("background");
  const [tool, setTool] = useState<"select" | "draw">("select");
  const [brushColor, setBrushColor] = useState("#f386a1");
  const [brushSize, setBrushSize] = useState(12);
  const [showStickers, setShowStickers] = useState(false);
  const [canvasSize, setCanvasSize] = useState(600);
  const [draftLine, setDraftLine] = useState<number[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const drawingRef = useRef(false);
  const draftLineRef = useRef<number[]>([]);
  const uploadModeRef = useRef<"image" | "background">("image");
  const readyRef = useRef(false);

  useEffect(() => {
    let active = true;
    readyRef.current = false;
    const load = async () => {
      let current: MixRecord | null = null;
      let userId = "demo";
      try {
        const response = await fetch("/api/auth/session");
        userId = publicUserId(await response.json());
        current = readLocalMix(id, userId) || (userId !== "demo" ? readLocalMix(id, "demo") : null);
      } catch { /* Session errors leave the editor empty. */ }
      if (!current) {
        try {
          const response = await fetch("/api/history");
          const data = await response.json() as { mixes?: MixRecord[] };
          current = data.mixes?.find((item) => item.id === id && item.userId === userId) || null;
        } catch { /* The local crate may still hold this mix. */ }
      }
      let project: ArtProject | undefined;
      try { project = await readArtProject(id); } catch { /* Editing still works without browser storage. */ }
      if (!active) return;
      setMix(current);
      setDoc(project || newArtProject(current?.coverDataUrl));
      setLoaded(true);
      readyRef.current = true;
    };
    void load();
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    const host = canvasWrapRef.current;
    if (!host) return;
    const resize = () => setCanvasSize(Math.max(1, Math.floor(host.clientWidth)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, [loaded]);

  useEffect(() => {
    if (!loaded || !readyRef.current) return;
    storeArtProject(id, doc).catch(() => setError("Your browser could not save this editable project. Export the cover before leaving."));
  }, [doc, id, loaded]);

  const selected = doc.layers.find((layer) => layer.id === selectedId);
  const commit = useCallback((next: ArtProject) => {
    setPast((items) => [...items, doc].slice(-40));
    setFuture([]);
    setDoc(next);
    setSavedMessage("");
  }, [doc]);
  const patchLayer = (idToPatch: string, patch: Partial<ArtLayer>) => commit({ ...doc, layers: doc.layers.map((layer) => layer.id === idToPatch ? { ...layer, ...patch } : layer) });
  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((items) => [doc, ...items]);
    setDoc(past[past.length - 1]);
    setPast(past.slice(0, -1));
    setSelectedId("background");
  }, [doc, past]);
  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((items) => [...items, doc]);
    setDoc(future[0]);
    setFuture(future.slice(1));
    setSelectedId("background");
  }, [doc, future]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault(); redo();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedId !== "background") {
        event.preventDefault(); commit({ ...doc, layers: doc.layers.filter((layer) => layer.id !== selectedId) });
        setSelectedId("background");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectedId, doc, commit]);

  useEffect(() => {
    const node = nodeRefs.current.get(selectedId);
    const transformer = transformerRef.current;
    if (!transformer) return;
    transformer.nodes(node && selected && !selected.locked && !selected.hidden && tool === "select" ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, selected, tool, doc.layers]);

  function addLayer(layer: Omit<ArtLayer, "id" | "rotation" | "scaleX" | "scaleY" | "hidden" | "locked">) {
    const item: ArtLayer = { ...layer, id: crypto.randomUUID(), rotation: 0, scaleX: 1, scaleY: 1, hidden: false, locked: false };
    commit({ ...doc, layers: [...doc.layers, item] });
    setSelectedId(item.id);
    setTool("select");
    setShowStickers(false);
  }

  async function handleFile(file?: File) {
    if (!file) return;
    setError("");
    try {
      const image = await prepareImage(file);
      if (uploadModeRef.current === "background") {
        commit({ ...doc, backgroundSrc: image.src });
        setSelectedId("background");
      } else {
        const ratio = Math.min(1, 720 / Math.max(image.width, image.height));
        const width = Math.round(image.width * ratio);
        const height = Math.round(image.height * ratio);
        addLayer({ kind: "image", name: file.name.replace(/\.[^.]+$/, "").slice(0, 30) || "Image", x: (ART_SIZE - width) / 2, y: (ART_SIZE - height) / 2, width, height, src: image.src });
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import this image."); }
    if (fileRef.current) fileRef.current.value = "";
  }

  function openFile(mode: "image" | "background") {
    uploadModeRef.current = mode;
    fileRef.current?.click();
  }

  function moveLayer(idToMove: string, direction: -1 | 1) {
    const index = doc.layers.findIndex((layer) => layer.id === idToMove);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= doc.layers.length) return;
    const layers = [...doc.layers];
    [layers[index], layers[swap]] = [layers[swap], layers[index]];
    commit({ ...doc, layers });
  }

  function pointerPosition() {
    const point = stageRef.current?.getPointerPosition();
    if (!point) return null;
    const scale = canvasSize / ART_SIZE;
    return [Math.max(0, Math.min(ART_SIZE, point.x / scale)), Math.max(0, Math.min(ART_SIZE, point.y / scale))];
  }

  function startDraw() {
    if (tool !== "draw") return;
    const position = pointerPosition();
    if (!position) return;
    drawingRef.current = true;
    draftLineRef.current = [...position, ...position];
    setDraftLine(draftLineRef.current);
  }
  function moveDraw() {
    if (!drawingRef.current) return;
    const position = pointerPosition();
    if (position) {
      draftLineRef.current = [...draftLineRef.current, ...position];
      setDraftLine(draftLineRef.current);
    }
  }
  function endDraw() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (draftLineRef.current.length >= 4) {
      const item: ArtLayer = { id: crypto.randomUUID(), kind: "draw", name: "Brush stroke", x: 0, y: 0, width: ART_SIZE, height: ART_SIZE, rotation: 0, scaleX: 1, scaleY: 1, hidden: false, locked: false, points: draftLineRef.current, color: brushColor, strokeWidth: brushSize };
      commit({ ...doc, layers: [...doc.layers, item] });
      setSelectedId(item.id);
    }
    draftLineRef.current = [];
    setDraftLine([]);
  }

  function exportImage(mimeType: "image/png" | "image/jpeg") {
    const stage = stageRef.current;
    if (!stage) throw new Error("The canvas is still loading.");
    const transformer = transformerRef.current;
    transformer?.visible(false);
    transformer?.getLayer()?.draw();
    try { return stage.toDataURL({ mimeType, quality: .88, pixelRatio: ART_SIZE / canvasSize }); }
    finally { transformer?.visible(true); transformer?.getLayer()?.draw(); }
  }

  function download() {
    try {
      const link = document.createElement("a");
      link.href = exportImage("image/png");
      link.download = `${(mix?.name || "playlist").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-cover-1024.png`;
      link.click();
      setSavedMessage("Downloaded a 1024 × 1024 PNG.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export cover."); }
  }

  async function useCover() {
    if (!mix) return;
    setWorking(true); setError(""); setSavedMessage("");
    try {
      const coverDataUrl = exportImage("image/jpeg");
      if (mix.userId === "demo") {
        storeLocalMix({ ...mix, coverDataUrl });
        await storeArtProject(id, doc).catch(() => null);
        router.push(`/mix/${id}`);
        return;
      }
      const response = await fetch("/api/mixes/cover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mix, coverDataUrl }) });
      const data = await response.json() as { mix?: MixRecord; error?: string };
      if (!response.ok || !data.mix) throw new Error(data.error || "Could not set this cover.");
      storeLocalMix(data.mix);
      await storeArtProject(id, doc).catch(() => null);
      router.push(`/mix/${id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not set this cover."); }
    finally { setWorking(false); }
  }

  if (!loaded) return <main className="art-loading" role="status">Opening your art studio…</main>;
  if (!mix) return <main className="art-loading"><p>We couldn&apos;t find this mix.</p><button onClick={() => router.push("/history")}>Back to your mixes</button></main>;

  return <main className={`${styles.editor} app-art-editor`}>
    <header className={styles.header}>
      <div className={styles.headerStart}><button className={styles.iconButton} aria-label="Back to mix" onClick={() => router.push(`/mix/${id}`)}><X size={22} /></button><div><strong>Create your playlist art</strong><span>{mix.name} · {mix.userId === "demo" ? "Saved in this browser" : mix.spotifyId ? "Updates Spotify too" : "Ready when you save to Spotify"}</span></div></div>
      <div className={styles.headerActions}>
        <ThemeToggle />
        <button className={styles.iconButton} onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo"><Undo2 size={20} /></button>
        <button className={styles.iconButton} onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo"><Redo2 size={20} /></button>
        <span className={styles.divider} />
        <button className={styles.textButton} onClick={download}><Download size={17} /> Export PNG</button>
        <button className={styles.useButton} disabled={working} onClick={useCover}>{working ? "Setting cover…" : <><Check size={17} /> Use this cover</>}</button>
      </div>
    </header>

    <div className={styles.body}>
      <aside className={styles.sidebar} aria-label="Layers">
        <div className={styles.sidebarHeading}><div><span className={styles.eyebrow}>YOUR CANVAS</span><h1>Layers</h1></div><span className={styles.count}>{doc.layers.length + 1}</span></div>
        <p className={styles.sidebarHint}>Select a layer to edit. Drag on the canvas to move it.</p>
        <div className={styles.layerList}>
          {[...doc.layers].reverse().map((layer) => <div key={layer.id} className={`${styles.layerRow} ${selectedId === layer.id ? styles.activeLayer : ""}`}>
            <button className={styles.layerSelect} onClick={() => { setSelectedId(layer.id); setTool("select"); }} title={`Select ${objectName(layer)}`}><span className={styles.layerThumb}>{layer.kind === "image" ? <ImagePlus size={19} /> : layer.kind === "draw" ? <Pencil size={19} /> : layer.kind === "sticker" ? layer.text : <Type size={19} />}</span><span className={styles.layerName}>{objectName(layer)}</span></button>
            <button className={styles.tinyButton} title={layer.hidden ? "Show layer" : "Hide layer"} aria-label={layer.hidden ? `Show ${objectName(layer)}` : `Hide ${objectName(layer)}`} onClick={() => patchLayer(layer.id, { hidden: !layer.hidden })}>{layer.hidden ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            <button className={styles.tinyButton} title={layer.locked ? "Unlock layer" : "Lock layer"} aria-label={layer.locked ? `Unlock ${objectName(layer)}` : `Lock ${objectName(layer)}`} onClick={() => patchLayer(layer.id, { locked: !layer.locked })}>{layer.locked ? <LockKeyhole size={15} /> : <UnlockKeyhole size={15} />}</button>
          </div>)}
          <button className={`${styles.layerRow} ${styles.backgroundRow} ${selectedId === "background" ? styles.activeLayer : ""}`} onClick={() => { setSelectedId("background"); setTool("select"); }}><span className={styles.layerThumb} style={{ background: doc.backgroundColor }}>{doc.backgroundSrc ? <ImagePlus size={19} /> : null}</span><span className={styles.layerName}>Background</span><LockKeyhole size={15} /></button>
        </div>
        {selected && <div className={styles.layerActions}>
          <button onClick={() => moveLayer(selected.id, 1)} disabled={doc.layers.at(-1)?.id === selected.id} title="Move layer forward" aria-label="Move layer forward"><ArrowUp size={16} /></button>
          <button onClick={() => moveLayer(selected.id, -1)} disabled={doc.layers[0]?.id === selected.id} title="Move layer backward" aria-label="Move layer backward"><ArrowDown size={16} /></button>
          <button onClick={() => { const copy = { ...selected, id: crypto.randomUUID(), name: `${selected.name} copy`, x: selected.x + 28, y: selected.y + 28 }; commit({ ...doc, layers: [...doc.layers, copy] }); setSelectedId(copy.id); }} title="Duplicate layer" aria-label="Duplicate layer"><Plus size={16} /></button>
          <button onClick={() => { commit({ ...doc, layers: doc.layers.filter((layer) => layer.id !== selected.id) }); setSelectedId("background"); }} title="Delete layer" aria-label="Delete layer"><Trash2 size={16} /></button>
        </div>}
        <div className={styles.sidebarFoot}><span>PLAYLIST ART STUDIO</span><span>01 / 01</span></div>
      </aside>

      <section className={styles.workspace} aria-label="Playlist cover editor">
        <div className={styles.canvasArea}>
          <div className={styles.canvasOuter}><div className={styles.canvasWrap} ref={canvasWrapRef}>
            <Stage ref={stageRef} width={canvasSize} height={canvasSize} scaleX={canvasSize / ART_SIZE} scaleY={canvasSize / ART_SIZE}
              onMouseDown={(event) => { if (tool === "draw") startDraw(); else if (event.target === event.target.getStage() || event.target.name() === "background") setSelectedId("background"); }}
              onTouchStart={(event) => { if (tool === "draw") { event.evt.preventDefault(); startDraw(); } else if (event.target.name() === "background") setSelectedId("background"); }}
              onMouseMove={moveDraw} onTouchMove={(event) => { if (tool === "draw") event.evt.preventDefault(); moveDraw(); }}
              onMouseUp={endDraw} onTouchEnd={endDraw} onMouseLeave={endDraw}>
              <Layer>
                <Rect name="background" x={0} y={0} width={ART_SIZE} height={ART_SIZE} fill={doc.backgroundColor} listening={tool === "select"} />
                {doc.backgroundSrc && <BackgroundImage src={doc.backgroundSrc} effect={doc.backgroundEffect} />}
                {doc.layers.map((layer) => {
                  if (layer.hidden) return null;
                  const common = {
                    x: layer.x, y: layer.y, rotation: layer.rotation, scaleX: layer.scaleX, scaleY: layer.scaleY,
                    draggable: tool === "select" && !layer.locked,
                    listening: tool === "select" && !layer.locked,
                    onClick: () => setSelectedId(layer.id), onTap: () => setSelectedId(layer.id),
                    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => patchLayer(layer.id, { x: event.target.x(), y: event.target.y() }),
                    onTransformEnd: (event: Konva.KonvaEventObject<Event>) => patchLayer(layer.id, { x: event.target.x(), y: event.target.y(), rotation: event.target.rotation(), scaleX: event.target.scaleX(), scaleY: event.target.scaleY() }),
                  };
                  const register = (node: Konva.Node | null) => { if (node) nodeRefs.current.set(layer.id, node); else nodeRefs.current.delete(layer.id); };
                  if (layer.kind === "image" && layer.src) return <EffectImage key={layer.id} nodeRef={register} src={layer.src} effect={layer.effect} width={layer.width} height={layer.height} {...common} />;
                  if (layer.kind === "draw") return <Line key={layer.id} ref={register} {...common} points={layer.points || []} stroke={layer.color || "#f386a1"} strokeWidth={layer.strokeWidth || 12} lineCap="round" lineJoin="round" tension={.35} />;
                  return <Text key={layer.id} ref={register} {...common} text={layer.text || ""} width={layer.width} fontSize={layer.fontSize || 90} fontFamily={layer.fontFamily || "Arial"} fontStyle={layer.kind === "text" ? "bold" : "normal"} fill={layer.color || "#3c2d31"} align="center" wrap="word" />;
                })}
                {draftLine.length >= 4 && <Line points={draftLine} stroke={brushColor} strokeWidth={brushSize} lineCap="round" lineJoin="round" tension={.35} listening={false} />}
                <Transformer ref={transformerRef} rotateEnabled anchorSize={12} borderStroke="#d85e80" anchorStroke="#d85e80" anchorFill="#ffffff" keepRatio={false} boundBoxFunc={(_, next) => Math.abs(next.width) < 24 || Math.abs(next.height) < 24 ? _ : next} />
              </Layer>
            </Stage>
          </div></div>
          <div className={styles.canvasCaption}><span>ARTWORK / {mix.name.toUpperCase()}</span><span>1:1 · 1024 × 1024 PX</span></div>
        </div>
        <div className={styles.toolbar} role="toolbar" aria-label="Add to playlist art">
          <button onClick={() => openFile("image")} title="Add image"><ImagePlus size={20} /><span>Image</span></button>
          <button onClick={() => addLayer({ kind: "text", name: "Text", x: 130, y: 430, width: 760, height: 120, text: "Your words here", fontSize: 86, fontFamily: "Arial", color: "#ffffff" })} title="Add text"><Type size={21} /><span>Text</span></button>
          <button className={showStickers ? styles.toolbarActive : ""} onClick={() => setShowStickers((value) => !value)} title="Add sticker"><Sticker size={20} /><span>Stickers</span></button>
          <button className={tool === "draw" ? styles.toolbarActive : ""} onClick={() => { setTool(tool === "draw" ? "select" : "draw"); setShowStickers(false); setSelectedId("background"); }} title="Draw"><Pencil size={20} /><span>Draw</span></button>
        </div>
        {showStickers && <div className={styles.stickerTray} aria-label="Choose a sticker">{STICKERS.map((sticker) => <button key={sticker} aria-label={`Add ${sticker} sticker`} onClick={() => addLayer({ kind: "sticker", name: "Sticker", x: 392, y: 392, width: 240, height: 180, text: sticker, fontSize: 170, color: "#f386a1" })}>{sticker}</button>)}</div>}
      </section>

      <aside className={styles.properties} aria-label="Layer settings">
        <span className={styles.eyebrow}>MAKE IT YOURS</span>
        <h2>{tool === "draw" ? "Brush" : selected ? selected.kind === "sticker" ? "Sticker" : selected.kind === "draw" ? "Brush stroke" : selected.kind === "image" ? "Image" : "Text" : "Background"}</h2>
        <p className={styles.propertyHint}>{tool === "draw" ? "Draw directly on the artwork." : selected ? "Adjust the selected layer." : "Set the foundation for your cover."}</p>
        {tool === "draw" ? <div className={styles.controlStack}>
          <label>Brush color <input type="color" value={brushColor} onChange={(event) => setBrushColor(event.target.value)} /></label>
          <label>Brush size <input type="range" min="2" max="64" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /><span>{brushSize}px</span></label>
          <button className={styles.outlineButton} onClick={() => setTool("select")}>Done drawing</button>
        </div> : selected ? <div className={styles.controlStack}>
          {selected.kind === "text" && <>
            <label>Words <textarea value={selected.text || ""} rows={3} maxLength={100} onChange={(event) => patchLayer(selected.id, { text: event.target.value })} /></label>
            <label>Font <select value={selected.fontFamily || "Arial"} onChange={(event) => patchLayer(selected.id, { fontFamily: event.target.value })}><option value="Arial">Sans serif</option><option value="Georgia">Serif</option><option value="Courier New">Monospace</option><option value="Impact">Poster</option></select></label>
            <label>Size <input type="range" min="28" max="180" value={selected.fontSize || 86} onChange={(event) => patchLayer(selected.id, { fontSize: Number(event.target.value) })} /><span>{selected.fontSize || 86}px</span></label>
          </>}
          {(selected.kind === "text" || selected.kind === "sticker" || selected.kind === "draw") && <label>Color <input type="color" value={selected.color || "#f386a1"} onChange={(event) => patchLayer(selected.id, { color: event.target.value })} /></label>}
          {selected.kind === "draw" && <label>Stroke <input type="range" min="2" max="64" value={selected.strokeWidth || 12} onChange={(event) => patchLayer(selected.id, { strokeWidth: Number(event.target.value) })} /><span>{selected.strokeWidth || 12}px</span></label>}
          {selected.kind === "image" && <label>Effect <select value={selected.effect || "none"} onChange={(event) => patchLayer(selected.id, { effect: event.target.value as ArtEffect })}>{EFFECTS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>}
          <label>Rotate <input type="range" min="-180" max="180" value={selected.rotation} onChange={(event) => patchLayer(selected.id, { rotation: Number(event.target.value) })} /><span>{Math.round(selected.rotation)}°</span></label>
          <button className={styles.outlineButton} onClick={() => patchLayer(selected.id, { rotation: 0, scaleX: 1, scaleY: 1 })}><RotateCcw size={15} /> Reset transform</button>
        </div> : <div className={styles.controlStack}>
          <label>Canvas color <input type="color" value={doc.backgroundColor} onChange={(event) => commit({ ...doc, backgroundColor: event.target.value })} /></label>
          <button className={styles.outlineButton} onClick={() => openFile("background")}><ImagePlus size={16} /> {doc.backgroundSrc ? "Replace background" : "Add background image"}</button>
          {doc.backgroundSrc && <><label>Effect <select value={doc.backgroundEffect} onChange={(event) => commit({ ...doc, backgroundEffect: event.target.value as ArtEffect })}>{EFFECTS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label><button className={styles.plainButton} onClick={() => commit({ ...doc, backgroundSrc: undefined })}>Remove background image</button></>}
        </div>}
        <div className={styles.propertiesFoot}><div className={styles.tipIcon}>✦</div><p><strong>Little tip</strong><br />Use the handles to resize or rotate a layer. Layers at the top sit in front.</p></div>
      </aside>
    </div>
    {(error || savedMessage) && <div className={`${styles.toast} ${error ? styles.toastError : ""}`} role={error ? "alert" : "status"}>{error || savedMessage}<button aria-label="Dismiss message" onClick={() => { setError(""); setSavedMessage(""); }}><X size={16} /></button></div>}
    <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => void handleFile(event.target.files?.[0])} />
  </main>;
}
