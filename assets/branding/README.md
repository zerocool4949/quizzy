# Quizzy branding

- `icon.png`: 1024px master.
- `icon-512.png`: square icon for dashboards and repository avatars.
- `social-preview.jpg`: 1280×640 GitHub social preview. Upload under repository Settings → General → Social preview.

Portainer app templates support a `logo` field containing an image URL. Host `icon-512.png` at a URL accessible to the browser and set that field in your existing template. This does not change icons in the running container or stack list. No deployment settings or live Portainer configuration were changed.

GitHub repositories use README images and social previews rather than individual repository avatars. Other Git hosts with repository avatars can use `icon-512.png`.

Portainer format: https://docs.portainer.io/advanced/app-templates/format
GitHub preview: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview
