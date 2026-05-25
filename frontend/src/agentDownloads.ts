/** Static agent files served from frontend/public/downloads/ (synced via copy-agent-assets). */

export const AGENT_DOWNLOADS = [
  {
    filename: 'local_agent.py',
    label: 'local_agent.py',
    href: '/downloads/local_agent.py',
    description: 'Runs on your PC and executes gesture/voice commands.',
  },
  {
    filename: 'agent_requirements.txt',
    label: 'agent_requirements.txt',
    href: '/downloads/agent_requirements.txt',
    description: 'Python dependencies for the local agent.',
  },
] as const;

export function downloadAgentFile(href: string, filename: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
