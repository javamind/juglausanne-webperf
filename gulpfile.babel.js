'use strict';

import gulp from 'gulp';
import del from 'del';
import runSequence from 'run-sequence';
import gulpLoadPlugins from 'gulp-load-plugins';
import swPrecache from 'sw-precache';

const imagemin = require('gulp-imagemin');
const imageminMozjpeg = require('imagemin-mozjpeg');
var webpackStream = require('webpack-stream');
var webpack2 = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const $ = gulpLoadPlugins();

const paths = {
  main: 'src/main',
  tmp: 'build/.tmp',
  dist: 'build/resources/main/static',
  vendors: [
    'node_modules/babel-polyfill/dist/polyfill.min.js',
    'node_modules/jquery/dist/jquery.slim.min.js',
    'node_modules/zepto/dist/zepto.min.js',
    'node_modules/bootstrap/dist/js/bootstrap.min.js',
    'node_modules/moment/min/moment.min.js'
  ],
  vendorsToMinify: [
    'node_modules/markdown/lib/markdown.js',
    'node_modules/fg-loadcss/src/loadCSS.js',
    'node_modules/fg-loadcss/src/cssrelpreload.js'
  ]
};

// Lint JavaScript
gulp.task('lint', () =>
  gulp.src([`${paths.main}/web/**/*.js`, '!node_modules/**'])
    .pipe($.eslint())
    .pipe($.eslint.format())
    .pipe($.eslint.failOnError())
);

// Optimize images
gulp.task('images-min', () =>
  gulp.src(`${paths.main}/images/**/*.{svg,png,jpg}`)
    //.pipe($.size({title: 'images-min', showFiles: true}))
    //.pipe($.newer(`${paths.tmp}/images`))
    .pipe(imagemin([imagemin.gifsicle(), imageminMozjpeg(), imagemin.optipng(), imagemin.svgo()], {
      progressive: true,
      interlaced: true,
      arithmetic: true,
    }))
    .pipe($.size({title: 'images-min', showFiles: true}))
    .pipe(gulp.dest(`${paths.tmp}/images`))
);

gulp.task('images', ['images-min'], () =>
  gulp.src(`${paths.tmp}/images/**/*.{png,jpg}`)
    .pipe($.webp())
    .pipe($.size({title: 'images'}))
    .pipe(gulp.dest(`${paths.dist}/img`))
);

// Compile and automatically prefix stylesheets
gulp.task('styles', () => {
  const AUTOPREFIXER_BROWSERS = [
    'ie >= 10',
    'ie_mob >= 10',
    'ff >= 30',
    'chrome >= 34',
    'safari >= 7',
    'opera >= 23',
    'ios >= 7',
    'android >= 4.4',
    'bb >= 10'
  ];

  return gulp.src([`${paths.main}/less/app.less`])
    .pipe($.newer(`${paths.tmp}/styles`))
    .pipe($.sourcemaps.init())
    .pipe($.less())
    .pipe($.autoprefixer(AUTOPREFIXER_BROWSERS))
    .pipe(gulp.dest(`${paths.tmp}/styles`))
    .pipe($.if('*.css', $.uncss({
      html: [`${paths.main}/*.html`, `${paths.main}/web/**/*.html`, `${paths.main}/web/**/*.js`]
     })))
    .pipe($.if('*.css', $.cssnano()))
    .pipe($.size({title: 'styles'}))
    .pipe($.sourcemaps.write('./'))
    .pipe(gulp.dest(`${paths.dist}/styles`));
});

// Concatenate and minify JavaScript. Optionally transpiles ES2015 code to ES5.
gulp.task('scripts', () =>
  gulp.src(`${paths.main}/web/**/*.js`)
    .pipe(webpackStream({
      output: {
        filename: "app.bundle.js"
      },
      devtool: "source-map",
      module: {
        rules: [
          {
            test: /\.js$/,
            exclude: [/node_modules/],
            use: [{
              loader: 'babel-loader',
              options: { presets: ['es2015'] }
            }],
          },
        ],
      }
      //,
      // plugins: [
      //   new HtmlWebpackPlugin({ title: 'Tree-shaking' })
      // ]
    }, webpack2))
    .pipe($.size({title: 'scripts'}))
    .pipe(gulp.dest(`${paths.tmp}/scripts`))
);

// Copy over the scripts that are used in importScripts as part of the generate-service-worker task.
gulp.task('vendors', () => {
  gulp.src(paths.vendors).pipe(gulp.dest(`${paths.dist}/vendors`));

  return gulp.src(paths.vendorsToMinify)
    .pipe($.newer(`${paths.tmp}/vendors`))
    .pipe($.sourcemaps.init())
    .pipe($.uglify({preserveComments: 'none'}))
    .pipe($.sourcemaps.write())
    .pipe(gulp.dest(`${paths.tmp}/vendors`))
    .pipe($.sourcemaps.write('.'))
    .pipe(gulp.dest(`${paths.dist}/vendors`));
});

const HTML_MINIFIER_CONFIG = {
  removeComments: true,
  collapseWhitespace: true,
  collapseBooleanAttributes: true,
  removeAttributeQuotes: true,
  removeRedundantAttributes: true,
  removeEmptyAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  removeOptionalTags: true,
  minifyCSS: true
};

// Scan your HTML for assets & optimize them
gulp.task('html-template', () => {
  return gulp.src(`${paths.main}/web/**/*.html`)
    .pipe($.htmlmin(HTML_MINIFIER_CONFIG))
    .pipe(gulp.dest(`${paths.tmp}`));
});

gulp.task('html', () => {

  return gulp.src([`${paths.main}/*.html`, `${paths.main}/web/**/*.html`])
    .pipe($.useref({
      searchPath: `{${paths.tmp},${paths.main}/web}`,
      noAssets: true
    }))
    .pipe($.if('*.html', $.htmlmin(HTML_MINIFIER_CONFIG)))
    .pipe($.if('*.html', $.size({title: 'html', showFiles: true})))
    .pipe(gulp.dest(paths.dist));
});

gulp.task('copy', () => {
  return gulp.src([`${paths.main}/resources/static/**/*.*`])
    .pipe(gulp.dest(paths.dist));
});

gulp.task('copy-images', () =>
  gulp.src(`${paths.tmp}/images/**/*.{svg,png,jpg}`)
    .pipe(gulp.dest(`${paths.dist}/img`))
);

gulp.task('copy-js', ['scripts'], () =>
  gulp.src([`${paths.tmp}/scripts/app.bundle.js`, `${paths.tmp}/scripts/**/*.map`])
    .pipe($.if('*.js', $.uglify({preserveComments: 'none'})))
    .pipe($.size({title: 'scripts'}))
    .pipe(gulp.dest(`${paths.dist}`))
);

gulp.task('generate-service-worker', function(callback) {
  let config = {
    cacheId: 'dev-mind',
    // Determines whether the fetch event handler is included in the generated service worker code. It is useful to
    // set this to false in development builds, to ensure that features like live reload still work. Otherwise, the content
    // would always be served from the service worker cache.
    handleFetch: true,
    runtimeCaching: [{
      urlPattern: '/(.*)',
      handler: 'fastest',
      options : {
        networkTimeoutSeconds: 3,
        maxAgeSeconds: 43200
      }
    }],
    staticFileGlobs: [ `${paths.dist}/**/*.{js,html,css,png,jpg,json,gif,svg,webp,eot,ttf,woff,woff2}`],
    stripPrefix: `${paths.dist}/`,
    verbose: true
  };

  swPrecache.write(`${paths.tmp}/service-worker.js`, config, callback);
});

gulp.task('package-service-worker', ['generate-service-worker'], () =>
  gulp.src(`${paths.tmp}/service-worker.js`)
    .pipe($.sourcemaps.init())
    .pipe($.sourcemaps.write())
    .pipe($.uglify({preserveComments: 'none'}))
    .pipe($.size({title: 'scripts'}))
    .pipe($.sourcemaps.write('.'))
    .pipe(gulp.dest(`${paths.dist}`))
);

// Clean output directory
gulp.task('clean', () => del([paths.dist], {dot: true}));

// Watch files for changes
gulp.task('watch', ['default'], () => {
  gulp.watch([`${paths.main}/**/*.html`], ['html-template', 'html']);
  gulp.watch([`${paths.main}/**/*.less`], ['styles']);
  gulp.watch([`${paths.main}/**/*.js`], ['lint', 'copy-js']);
  gulp.watch([`${paths.main}/**/*.{png,webp,svg,gif,jpg}`], ['images']);
});

gulp.task('build', cb =>
  runSequence(
    'styles',
    ['lint', 'html', 'html-template', 'vendors', 'scripts', 'images'],
    ['copy', 'copy-images', 'copy-js'],
    'package-service-worker',
    cb
  )
);

// Build production files, the default task
gulp.task('default', ['clean'], cb =>
  runSequence(
    'build',
    cb
  )
);