# BitterScan Web Dashboard

Expert validation portal for BitterScan - an AI-powered bitter gourd disease detection and fruit ripeness assessment system.

## Overview

BitterScan Web Dashboard is a Next.js-based web application that allows agricultural experts and administrators to validate AI predictions from the BitterScan mobile application. The system provides role-based access control for experts and administrators to review, validate, and correct scan results.

## Features

- **Expert Dashboard**: Validate and correct AI predictions for leaf disease and fruit ripeness scans
- **Admin Dashboard**: Comprehensive analytics and user management
- **Real-time Updates**: Live data synchronization using Supabase Realtime
- **Role-Based Access Control**: Separate interfaces for admins and experts
- **Data Visualization**: Interactive charts and statistics
- **Validation History**: Track all expert validations and corrections
- **Disease Information Management**: Manage disease database and solutions

## Tech Stack

- **Framework**: Next.js 15.5.12 (App Router)
- **Language**: TypeScript 5
- **Styling**: TailwindCSS 4, lightningcss
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **UI Components**: Radix UI, Lucide Icons
- **Charts**: Recharts
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Supabase account

### Installation

1. Clone the repository:
```bash
git clone https://github.com/mikeangelocasono/BitterScan-Web.git
cd BitterScan-Web
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env.local` file in the root directory:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
expert_dashboard/
├── app/                    # Next.js App Router pages
│   ├── admin-dashboard/   # Admin interface
│   ├── expert-dashboard/  # Expert interface
│   ├── login/             # Authentication
│   ├── validate/          # Scan validation
│   ├── history/           # Validation history
│   └── ...
├── components/            # React components
│   ├── UserContext.tsx    # Auth state management
│   ├── DataContext.tsx    # Data fetching & real-time updates
│   ├── AuthGuard.tsx      # Route protection
│   └── ui/                # UI components
├── types/                 # TypeScript type definitions
├── utils/                 # Utility functions
└── public/                # Static assets
```

## Authentication

The application uses Supabase Authentication with role-based access:

- **Admin**: Full system access, user management, analytics
- **Expert**: Scan validation, history access, profile management
- **Farmer**: Mobile app only (web access restricted)

## Database Schema

Key tables:
- `profiles`: User profiles with role and status
- `leaf_disease_scans`: Leaf disease scan data
- `fruit_ripeness_scans`: Fruit ripeness scan data
- `validation_history`: Expert validation records

## Deployment

### Vercel Deployment

1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy automatically on push to main branch

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is part of the BitterScan agricultural technology system.

## Contact

Project Link: [https://github.com/mikeangelocasono/BitterScan-Web](https://github.com/mikeangelocasono/BitterScan-Web)
