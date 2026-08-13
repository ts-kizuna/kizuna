import { features } from '@/lib/features';
import styles from './feature-cards.module.css';

export function FeatureCards() {
    return (
        <div className={styles.grid}>
            {features.map((feature) => (
                <article key={feature.title} className={styles.card}>
                    <div className={styles.icons}>
                        {feature.icons.map((Icon, index) => (
                            <Icon key={index} className={styles.icon} />
                        ))}
                    </div>
                    <h3 className={styles.title}>{feature.title}</h3>
                    <p className={styles.description}>{feature.description}</p>
                </article>
            ))}
        </div>
    );
}
