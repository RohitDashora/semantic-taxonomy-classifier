import KNNPanel from '../components/knn/KNNPanel.jsx';

export default function KNNView({ categories, embedding, scored, inputText }) {
  if (!embedding) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[var(--text-secondary)]">Search a channel or enter text to run Load 1 KNN refinement</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <KNNPanel
        categories={categories}
        embedding={embedding}
        scored={scored}
        inputText={inputText}
      />
    </div>
  );
}
