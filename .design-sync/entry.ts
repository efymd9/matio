// Точка входа бандла для claude.ai/design (design-sync).
//
// matio — приложение, а не пакет: собранного dist/ с экспортами компонентов
// не существует, поэтому бандл собирается прямо из исходников. Сюда попадают
// ТОЛЬКО компоненты, застендированные в UI Lab (истории = проверка фидельности;
// компонент без истории в Design не едет — нечем доказать, что он приехал
// целым). Добавил историю в Lab → добавь экспорт здесь.
export { Button, buttonVariants } from "../components/ui/button";
export { Poster } from "../components/site/poster";
export { SocialIcon } from "../components/site/social-icon";
export { MatioTheme } from "./theme";
