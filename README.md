# Stencil App

## About

Stencil App is a web application for converting images into high-quality multi-layer stencils for spray painting, artwork, laser cutting, and vinyl cutting. Upload an image, optionally remove the background using AI, then generate layered stencil previews that can be adjusted and exported.

---

## Features

* Upload JPG, PNG and WEBP images
* AI-powered background removal
* Realistic and Cartoon stencil generation modes
* Adjustable threshold, detail and bridging controls
* Multi-layer stencil previews
* SVG and PNG export
* Optimised for desktop browsers

---

## Running the Project Locally

### Prerequisites

Before you begin, make sure you have installed:

* Node.js (v18 or later recommended)
* npm (included with Node.js)

### Installation

Clone the repository:

```bash
git clone https://github.com/wickedpaint-gif/StencilApp.git
```

Navigate to the project folder:

```bash
cd StencilApp
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open your browser and visit:

```
http://localhost:5173
```

---

## Project Structure

```
src/
├── assets/          Images, logos and icons
├── components/      Reusable React components
├── lib/             Image processing and stencil generation
├── pages/           Application pages
├── services/        Background removal and external services
└── styles/          Global styles
```

---

## Building for Production

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

---

## Deployment

This project is configured for deployment on **Vercel**.

After pushing changes to the `main` branch, Vercel will automatically build and deploy the latest version.

---

## Technologies Used

* React
* Vite
* Tailwind CSS
* React Router
* React Query
* Framer Motion
* ImageTracerJS
* Polygon Clipping


---

## Contributing

Contributions, bug reports and feature suggestions are welcome. Feel free to open an issue or submit a pull request.

---

## License

This project is licensed under the MIT License unless otherwise stated.
