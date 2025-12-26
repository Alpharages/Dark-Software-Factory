export interface ActionItem {
    id: string;
    owner: string;
    task: string;
    due_date: string;
    priority: 'high' | 'medium' | 'low';
}
