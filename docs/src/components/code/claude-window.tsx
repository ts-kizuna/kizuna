import ClaudeLogo from '@/icons/Claude.svg';
import styles from './claude-window.module.css';

export function ClaudeWindow() {
    return (
        <div className={styles.window}>
            <div className={styles.dots}>
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.dot} />
            </div>
            <div className={styles.titleBar}>
                <ClaudeLogo className={styles.titleIcon} />
                Claude
            </div>
            <div className={styles.chat}>
                <div className={styles.promptRow}>
                    <span className={styles.promptCaret}>&gt;</span>
                    <span>Clean up the test users from yesterday&apos;s demo</span>
                </div>
                <div className={styles.turn}>
                    <span className={styles.bullet}>●</span>
                    <div className={styles.turnBody}>
                        <div>
                            <span className={styles.toolName}>users_list_users</span>
                            <span className={styles.toolArgs}>(name: &quot;Test&quot;)</span>
                            <span className={styles.toolNote}>read-only</span>
                        </div>
                        <div className={styles.toolResult}>
                            <span className={styles.resultElbow}>⎿</span>
                            <span>{'200 OK [{ "id": "51", "name": "Test User" }]'}</span>
                        </div>
                    </div>
                </div>
                <div className={styles.permissionBox}>
                    <div>
                        <span className={styles.toolName}>users_delete_user</span>
                        <span className={styles.toolArgs}>(id: &quot;51&quot;)</span>
                        <span className={styles.toolNote}>destructive</span>
                    </div>
                    <div className={styles.permissionQuestion}>Do you want to proceed?</div>
                    <div>❯ 1. Yes</div>
                    <div className={styles.permissionDeclined}>2. Yes, and don&apos;t ask again this session</div>
                    <div className={styles.permissionDeclined}>3. No</div>
                </div>
                <div className={styles.turn}>
                    <span className={styles.bullet}>●</span>
                    <div className={styles.turnBody}>
                        <div>
                            <span className={styles.toolName}>users_delete_user</span>
                            <span className={styles.toolArgs}>(id: &quot;51&quot;)</span>
                        </div>
                        <div className={styles.toolResult}>
                            <span className={styles.resultElbow}>⎿</span>
                            <span>204 No Content</span>
                        </div>
                    </div>
                </div>
                <div className={styles.turn}>
                    <span className={styles.bullet}>●</span>
                    <div className={styles.turnBody}>Found one test user and deleted it.</div>
                </div>
            </div>
        </div>
    );
}
