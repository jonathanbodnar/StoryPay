import WorkflowBuilderView from '@/components/marketing/WorkflowBuilderView';

export default async function WorkflowEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkflowBuilderView workflowId={id} />;
}
