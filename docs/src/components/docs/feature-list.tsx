import { features } from '@/lib/features';

/**
 * The feature list as prose bullets, for use inside MDX. Shares its source with
 * the landing page card grid so the two can never drift apart.
 */
export function FeatureList() {
    return (
        <ul>
            {features.map((feature) => (
                <li key={feature.title}>
                    <strong>{feature.title}</strong>: {feature.description}
                </li>
            ))}
        </ul>
    );
}
