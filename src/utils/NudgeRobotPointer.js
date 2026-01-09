export function NudgeRobotPointer({ editor, anchorShapeId, phaseTheme }) {
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!editor || !anchorShapeId) return;

    const update = () => {
      const b = editor.getShapePageBounds(anchorShapeId);
      if (!b) return;

      const pt = editor.pageToScreen({ x: b.minX, y: b.minY });
      setPos({ x: pt.x - 40, y: pt.y - 60 });
    };

    update();

    // keep it in sync while panning/zooming
    const unsub = editor.store.listen(update, { scope: "all" });

    return () => unsub?.();
  }, [editor, anchorShapeId]);

  if (!pos) return null;

  return (
    <div
      className={`nudge-robot nudge-robot-${phaseTheme}`}
      style={{ left: pos.x, top: pos.y }}
      onClick={() => {
        editor.select(anchorShapeId);
        editor.zoomToSelection();
      }}
      title="AI nudge here"
    >
      <div className="nudge-robot-body">🤖</div>
      <div className="nudge-robot-arrow">👇</div>
    </div>
  );
}
