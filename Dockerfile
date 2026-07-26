FROM nginx:1.27-alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/medlookup.conf

COPY index.html style.css script.js theme.js /usr/share/nginx/html/

EXPOSE 3000